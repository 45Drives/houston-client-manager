import { BackUpManager } from "./types";
import { BackUpTask, TaskSchedule } from "@45drives/houston-common-lib";
import { formatDateForTask, getNoneQuotedScp, getScp, getSmbTargetFromSSHTarget, getSSHKey, getSSHTargetFromSmbTarget } from "../utils";
import sudo from 'sudo-prompt';
import path from "path";
import fs from 'fs';
import os from 'os';
import { exec } from "child_process";

const TASK_ID = "HoustonBackUp";

export class BackUpManagerWin implements BackUpManager {

  protected runScriptAdmin(powershellScript: string, scriptName: string): Promise<{ stdout: string, stderr: string }> {
    const options = {
      name: 'Houston Client Manager'
    };

    // Save to file
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `${scriptName}.ps1`);
    fs.writeFileSync(scriptPath, powershellScript);

    return new Promise((resolve, reject) => {
      sudo.exec(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, options, (error, stdout, stderr) => {
        if (error) return reject(error);
        resolve({ stdout: stdout === undefined ? "" : stdout.toString(), stderr: stderr === undefined ? "" : stderr.toString() });
      });
    });

  }


  protected runScript(powershellScript: string, scriptName: string): Promise<{ stdout: string, stderr: string }> {
    // Save to file
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `${scriptName}.ps1`);
    fs.writeFileSync(scriptPath, powershellScript);

    return new Promise((resolve, reject) => {
      exec(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, (error, stdout, stderr) => {
        if (error) return reject(error);
        resolve({ stdout: stdout === undefined ? "" : stdout.toString(), stderr: stderr === undefined ? "" : stderr.toString() });
      });
    });

  }

  queryTasks(): Promise<BackUpTask[]> {
    const powerShellScript = `Get-ScheduledTask | Where-Object {$_.TaskName -like '*${TASK_ID}*'} | Select-Object TaskName, Triggers, Actions, State | ConvertTo-Json -depth 10`

    return this.runScriptAdmin(powerShellScript, "query_tasks")
      .then(result => {
        try {
          const tasks = JSON.parse(result.stdout.toString());
          const tasksAsArray = Array.isArray(tasks) ? tasks : [tasks];

          return tasksAsArray.map(task => {
            const actionProps = task.Actions[0].CimInstanceProperties;
            let command: string | null = null;
            for (let i = 0; i < actionProps.length; i++) {
              const prop = actionProps[i];
              if (prop.Name === 'Arguments') {
                command = prop.Value;
                break;
              }
            }
            if (!command) {
              console.log("No Command:", actionProps)
              return null;
            }
            const actionDetails = this.parseBackupCommand(command)
            if (!actionDetails) {
              console.log("task.Actions:", command)
              return null;
            }
            const trigger = this.convertTriggersToTaskSchedule(task.Triggers);

            if (!trigger) {
              console.log("Failed to parse Trigger:", task.Triggers);
              return null;
            }

            return {
              description: task.TaskName as string,
              schedule: trigger,
              source: actionDetails.source,
              target: actionDetails.target,
              mirror: actionDetails.mirror
            };
          }).filter(task => task !== null) as BackUpTask[];

        } catch (parseError) {
          console.error('Error parsing JSON:', parseError);
          return [];
        }

      });

  }

  async schedule(task: BackUpTask): Promise<{ stdout: string, stderr: string }> {

    const scp = getScp();

    // PowerShell script to create the task
    const powershellScript = `

$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

${this.addUserToBackupOperatorsGroup()}

${this.getAddBackupGroupsToLogOnBatchAndService()}

Write-Host "user being used: $user"

${this.chanagePrivilagesOnSSHKey()}

$sourcePath = "${task.source}"
$destinationPath = "${getSSHTargetFromSmbTarget(task.target)}"
$mirror = ${task.mirror ? "$true" : "$false"}  # Set to $true if you want to mirror the directories

if ($mirror) {
    $backupCommand = "${scp} ""$sourcePath"" root@$destinationPath"
} else {
    $backupCommand = "${scp} ""$sourcePath"" root@$destinationPath"
}

${this.scheduleToTaskTrigger(task.schedule)}

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/C $backupCommand"

$principal = New-ScheduledTaskPrincipal -UserId "$user" -LogonType S4U -RunLevel Highest

$task = Register-ScheduledTask -Action $action -Trigger $taskTrigger -Principal $principal -TaskName "${TASK_ID}_${crypto.randomUUID()}"

${this.dailyTaskTriggerUpdate(task.schedule)}

`;

    return this.runScriptAdmin(powershellScript, "create_task");
  }

  addUserToBackupOperatorsGroup() {
    return `
# Get current members of Backup Operators
$groupMembers = Get-LocalGroupMember -Group "Backup Operators" | Select-Object -ExpandProperty Name
Write-Output "Group Members: $groupMembers"

# Check if user is already a member before adding
if ($groupMembers -notcontains $user) {
    Add-LocalGroupMember -Group "Backup Operators" -Member $user
    Write-Output "$user added to Backup Operators."
} else {
    Write-Output "$user is already a member of Backup Operators."
}    
`
  }

  chanagePrivilagesOnSSHKey() {
    return `
$privateKey = "${getSSHKey()}"

# Ensure the file exists
if (!(Test-Path $privateKey)) {
    Write-Output "File does not exist: $privateKey"
    exit 1
}

# Get the current user
$activeUser = $env:USERNAME

# Get the ACL for the file
$acl = Get-Acl $privateKey

# Remove all existing access rules
$acl.SetAccessRuleProtection($true, $false)
$acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) }

# Grant full control to the active user only
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($activeUser, "FullControl", "Allow")
$acl.SetAccessRule($rule)

# Apply the new ACL settings
Set-Acl -Path $privateKey -AclObject $acl

Write-Output "Permissions updated: Only $activeUser has access to $privateKey"
`
  }

  getAddBackupGroupsToLogOnBatchAndService() {
    return `
# Check if "Backup Operators" has the required rights
$backupOperatorsGroup = "Backup Operators"
$requiredRights = @("SeBatchLogonRight", "SeServiceLogonRight")

# Export current security settings
$cfgFile = "$env:TEMP\\secpol.cfg"
secedit /export /areas USER_RIGHTS /cfg $cfgFile

# Get current rights from the policy
$content = Get-Content $cfgFile
$batchLogonRight = ($content | Select-String "SeBatchLogonRight").Line
$serviceLogonRight = ($content | Select-String "SeServiceLogonRight").Line

# Check if Backup Operators already have the rights
$hasBatchLogon = $batchLogonRight -like "*S-1-5-32-551"
$hasServiceLogon = $serviceLogonRight -like "*S-1-5-32-551"

# If Backup Operators do not have the required rights, modify the policy
if (-not $hasBatchLogon -or -not $hasServiceLogon) {
    Write-Output "Backup Operators do not have the required rights. Updating permissions..."

    # Modify the policy file
    if (-not $hasBatchLogon) {
        $content = $content -replace "(SeBatchLogonRight =.*)", "\`$1, *S-1-5-32-551"
    }
    if (-not $hasServiceLogon) {
        $content = $content -replace "(SeServiceLogonRight =.*)", "\`$1, *S-1-5-32-551"
    }

    # Save changes and apply policy
    $content | Set-Content $cfgFile
    secedit /configure /db c:\\windows\\security\\local.sdb /cfg $cfgFile /areas USER_RIGHTS /quiet
    Write-Output "Permissions updated. Restart required for changes to take effect."
} else {
    Write-Output "Backup Operators already have the required rights."
}
`
  }


  unschedule(task: BackUpTask): void {
    const powershellScript = `
Unregister-ScheduledTask -TaskName "${task.description}" -Confirm:$false
`;

    this.runScriptAdmin(powershellScript, "unchedule_task");

  }

  protected dailyTaskTriggerUpdate(schedule: TaskSchedule) {
    const dailyTaskTriggerUpdate = `
$task.Triggers.Repetition.Duration = "P1D"
$task.Triggers.Repetition.Interval = "PT1H"
$task | Set-ScheduledTask
`;
    if (schedule.repeatFrequency.toLocaleLowerCase() === "hour") {

      return dailyTaskTriggerUpdate;
    } else {
      return ""
    }
  }


  protected scheduleToTaskTrigger(sched: TaskSchedule): string | undefined {

    console.log(sched);

    const startDate = formatDateForTask(sched.startDate); // e.g., "2025-02-25 10:00:00"
    switch (sched.repeatFrequency.toLowerCase()) {
      case "hour":
        return `
$startTime = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -Daily -At $startTime
`;
      case "day":
        return `
$startTime = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -At $startTime -Daily
`;
      case "week":
        return `
$startTime = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -At $startTime -Weekly
`;
      case "month":
        return `
$startTime = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -At $startTime -Monthly
`;
      default:
        console.error("RepeatFrequency unknown", sched.repeatFrequency)
    }
  }

  protected convertTriggersToTaskSchedule(triggers: any[]): TaskSchedule | null {
    try {

      const triggersArray = triggers.map(trigger => {
        // Get the CimInstanceProperties string
        const cimProperties = trigger.CimInstanceProperties;

        // Use regular expressions to extract the relevant properties
        let startBoundaryMatch;
        let hoursIntervalMatch;
        let daysIntervalMatch;
        let weeksIntervalMatch;
        let monthsIntervalMatch;
        if (typeof cimProperties === 'string') {
          startBoundaryMatch = cimProperties.match(/StartBoundary\s*=\s*"([^"]+)"/);
          hoursIntervalMatch = cimProperties.match(/HoursInterval\s*=\s*(\d+)/);
          daysIntervalMatch = cimProperties.match(/DaysInterval\s*=\s*(\d+)/);
          weeksIntervalMatch = cimProperties.match(/WeeksInterval\s*=\s*(\d+)/);
          monthsIntervalMatch = cimProperties.match(/MonthsInterval\s*=\s*(\d+)/);
        } else if (Array.isArray(cimProperties)) {
          for (let i = 0; i < cimProperties.length; i++) {
            const prop = cimProperties[i];
            if (prop.Name === "StartBoundary") {
              startBoundaryMatch = prop.Value;
            } else if (prop.Name === "HoursInterval") {
              hoursIntervalMatch = prop.Value;
            } else if (prop.Name === "DaysInterval") {
              daysIntervalMatch = prop.Value;
            }
            else if (prop.Name === "WeeksInterval") {
              weeksIntervalMatch = prop.Value;
            }
            else if (prop.Name === "MonthsInterval") {
              monthsIntervalMatch = prop.Value;
            }
          }
        } else {
          startBoundaryMatch = cimProperties.StartBoundary;
          hoursIntervalMatch = cimProperties.HoursInterval;
          daysIntervalMatch = cimProperties.DaysInterval;
          weeksIntervalMatch = cimProperties.WeeksInterval;
          monthsIntervalMatch = cimProperties.MonthsInterval;
        }


        // Check if the matches were found and extract values
        if (startBoundaryMatch) {
          if (hoursIntervalMatch) {

            return {
              repeatFrequency: 'hour',
              startDate: new Date(startBoundaryMatch[1]),
            };

          } else if (daysIntervalMatch) {

            return {
              repeatFrequency: 'day',
              startDate: new Date(startBoundaryMatch[1]),
            };

          } else if (weeksIntervalMatch) {

            return {
              repeatFrequency: 'week',
              startDate: new Date(startBoundaryMatch[1]),
            };

          } else if (monthsIntervalMatch) {

            return {
              repeatFrequency: 'month',
              startDate: new Date(startBoundaryMatch[1]),
            };

          } else {
            // Assuming it is done hourly. Based on testing.
            return {
              repeatFrequency: 'hour',
              startDate: new Date(startBoundaryMatch[1]),
            };
          }
        }
        return null;
      }).filter(trigger => trigger !== null);

      if (triggersArray.length !== 1) {
        return null;
      } else {
        return triggersArray[0] as any;
      }
    } catch (error) {
      console.error("failed to match Triggers:", triggers)
      console.error(error)
      return null;
    }
  }

  protected parseBackupCommand(command: string): { source: string, target: string, mirror: boolean } | null {
    try {

      //$backupCommand = "${rsync} --delete $sourcePath root@$destinationPath"

      if (!command.includes(getNoneQuotedScp())) {
        return null;
      }

      const mirror = command.includes("--delete");
      command = command.replace("/C " + getNoneQuotedScp(), '')
        .replace("--delete", "")
        .replace("\"", "")
        .replace("\"", "")
        .replace("root@", "").trim();

      console.log(command)

      const regex = /([^\s]+(?:\s[^\s]+)*)\s+([^\s]+(?:\s[^\s]+)*)/;

      // Execute regex on the input command
      const match = command.match(regex);

      if (match) {
        const sourcePath = match[1]?.toString().replace('\'', "").replace('\'', "");
        const destinationPath = getSmbTargetFromSSHTarget(match[2]?.toString());

        if (!sourcePath || !destinationPath) {
          return null;
        }
        return {
          source: sourcePath,
          target: destinationPath,
          mirror
        };
      } else {
        return null;
      }
    } catch (parseError) {
      console.error('Error regex:', parseError);
      console.error('String value was:', command);
      return null;
    }
  }
}
