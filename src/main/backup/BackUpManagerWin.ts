import { BackUpManager } from "./types";
import { BackUpTask, TaskSchedule } from "@45drives/houston-common-lib";
import { spawnSync } from "child_process";
import { getNoneQuotedScp, getScp, getSmbTargetFromSSHTarget, getSSHTargetFromSmbTarget } from "../utils";

const TASK_ID = "HoustonBackUp";

export class BackUpManagerWin implements BackUpManager {

  queryTasks(): BackUpTask[] {
    const command = 'powershell';
    const args = [
      '-Command',
      `Get-ScheduledTask | Where-Object {$_.TaskName -like '*${TASK_ID}*'} | Select-Object TaskName, Triggers, Actions, State | ConvertTo-Json -depth 10`
    ];

    const argsShort = [
      '-Command',
      `Get-ScheduledTask | Where-Object {$_.TaskName -like '*${TASK_ID}*'} | Select-Object TaskName, Triggers, Actions, State | ConvertTo-Json`
    ];


    // Use spawnSync to run the command synchronously
    const result = spawnSync(command, args);
    const resultShort = spawnSync(command, argsShort);

    if (result.error) {
      console.error('Error executing command:', result.error);
      return [];
    }


    if (resultShort.error) {
      console.error('Error executing command:', result.error);
      return [];
    }

    try {
      const tasks = JSON.parse(result.stdout.toString());
      // const tasksShort = JSON.parse(resultShort.stdout.toString());
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

  }
  
  schedule(task: BackUpTask): void {

    const scp = getScp();

    // PowerShell script to create the task
    const powershellScript = `
$sourcePath = "${task.source}"
$destinationPath = "${getSSHTargetFromSmbTarget(task.target)}"
$mirror = ${task.mirror ? "true" : "false"}  # Set to $true if you want to mirror the directories

if ($mirror) {
    $backupCommand = "${scp} ""$sourcePath"" root@$destinationPath"
} else {
    $backupCommand = "${scp} ""$sourcePath"" root@$destinationPath"
}

$taskTrigger = ${this.scheduleToTaskTrigger(task.schedule)}

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/C $backupCommand"

Register-ScheduledTask -Action $action -Trigger $taskTrigger -TaskName "${TASK_ID}_${crypto.randomUUID()}" 
`;

    // Run PowerShell command with spawnSync
    const result = spawnSync('powershell', ['-Command', powershellScript]);

    // Check if the process ran successfully
    if (result.error) {
      console.error(`Error executing PowerShell script: ${result.error.message}`);
      console.error(`PowerShell script: ${powershellScript}`);
    } else {
      console.log('Backup task scheduled successfully.');
      console.log(`Standard Output: ${result.stdout.toString()}`);
      console.log(`Standard Error: ${result.stderr.toString()}`);
    }
  }

  unschedule(task: BackUpTask): void {
    const powershellScript = `
Unregister-ScheduledTask -TaskName "${task.description}" -Confirm:$false
`;

    // Run PowerShell command with spawnSync
    const result = spawnSync('powershell', ['-Command', powershellScript]);

    // Check if the process ran successfully
    if (result.error) {
      console.error(`Error executing PowerShell script: ${result.error.message}`);
    } else {
      console.log(`Task "${task.description}" removed successfully.`);
      console.log(`Standard Output: ${result.stdout.toString()}`);
      console.log(`Standard Error: ${result.stderr.toString()}`);
    }
  }

  protected scheduleToTaskTrigger(sched: TaskSchedule): string | undefined {

    console.log(sched);

    const startDate = sched.startDate.toISOString().replace('T', ' ').split('.')[0]; // e.g., "2025-02-25 10:00:00"

    switch (sched.repeatFrequency.toLowerCase()) {
      case "hour":
        return `
$startTime = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -At $startTime -Daily
$taskTrigger.Repetition = New-ScheduledTaskTrigger -Once -At $startTime -RepetitionInterval (New-TimeSpan -Hours 1)
`;
      case "day":
        return `
$startTime = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -At $startTime -Daily
$taskTrigger.RepetitionInterval = (New-TimeSpan -Days 1)
`;
      case "week":
        return `
$startTime = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -At $startTime -Weekly
$taskTrigger.RepetitionInterval = (New-TimeSpan -Weeks 1)
`;
      case "month":
        return `
$startTime = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -At $startTime -Monthly
$taskTrigger.RepetitionInterval = (New-TimeSpan -Months 1)
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
