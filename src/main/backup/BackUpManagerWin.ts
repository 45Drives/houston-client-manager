import log from 'electron-log';
log.transports.console.level = false;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
console.log = (...args) => log.info(...args);
console.error = (...args) => log.error(...args);
console.warn = (...args) => log.warn(...args);
console.debug = (...args) => log.debug(...args);

process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

import { BackUpManager } from "./types";
import { BackUpTask, TaskSchedule } from "@45drives/houston-common-lib";
import { formatDateForTask, formatDateForTask2, getAppPath, getMountSmbScript, getSmbTargetFromSmbTarget } from "../utils";
import sudo from 'sudo-prompt';
import path from "path";
import fs from 'fs';
import os from 'os';
import { exec } from "child_process";

const TASK_ID = "Houston_Backup_Task";

interface TaskData {
  source?: string;
  target?: string;
  description?: string;
  mirror?: boolean;
  schedule?: string;
  uuid?: string;
  SMB_HOST?: string;
  SMB_SHARE?: string;
}

export class BackUpManagerWin implements BackUpManager {

  protected runScriptAdmin(powershellScript: string, scriptName: string): Promise<{ stdout: string, stderr: string }> {
    const options = {
      name: '45Drives Setup Wizard'
    };

    // Save to file
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `${scriptName}.ps1`);
    console.log("running: " + scriptPath);
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


  private getTaskPaths(task: BackUpTask) {
    const pgm = process.env.ProgramData ?? "C:\\ProgramData";
    const share = task.share || task.target.split(":")[1].split("/")[0];
    return {
      bat: path.join(pgm, "houston-backups", "scripts", `Houston_Backup_Task_${task.uuid}.bat`),
      log: path.join(pgm, "houston-backups", "logs", `backup_task_${task.uuid}.log`),
      cred: path.join(pgm, "houston-backups", "credentials", `${share}.cred`),
      share
    };
  }
  
  queryTasks(): Promise<BackUpTask[]> {
    const powerShellScript = `Get-ScheduledTask | Where-Object {$_.TaskName -like '*${TASK_ID}*'} | Select-Object TaskName, Triggers, Actions, State | ConvertTo-Json -depth 10`

    return this.runScriptAdmin(powerShellScript, "query_tasks")
      .then(result => {
        if (!result.stdout || !result.stdout.trim()) {
          return [];                     // nothing to parse, no tasks
        }

        try {
          const tasks = JSON.parse(result.stdout.toString());
          const tasksAsArray = Array.isArray(tasks) ? tasks : [tasks];

          return tasksAsArray.map(task => {
            const actionProps = task.Actions[0].CimInstanceProperties;
            let command: string | null = null;
            for (let i = 0; i < actionProps.length; i++) {
              const prop = actionProps[i];
              if (prop.Name === 'Arguments' && prop.Value) {
                command = prop.Value;
                break;
              } else if (prop.Name === 'Execute' && prop.Value) {
                command = prop.Value;
                break;
              }
            }

            if (!command) {
              console.log("No Command:", actionProps)
              return null;
            }
            const actionDetails = this.parseBackupCommand(command)
            console.log(actionDetails)
            if (!actionDetails) {
              console.log("task.Actions:", command)
              return null;
            }
            const trigger = this.convertTriggersToTaskSchedule(task.Triggers);

            if (!trigger) {
              console.log("Failed to parse Trigger:", task.Triggers);
              return null;
            }

            const backUpTask: BackUpTask = {
              uuid: actionDetails.uuid!,
              description: actionDetails.description!,
              schedule: trigger!,
              source: actionDetails.source!,
              target: actionDetails.target!,
              mirror: actionDetails.mirror === true,
              host: actionDetails.SMB_HOST,
              share: actionDetails.SMB_SHARE,
              status: "checking"
            };

            if ((actionDetails as any).START_DATE) {
              backUpTask.schedule.startDate = new Date((actionDetails as any).START_DATE);
            }

            return backUpTask;
          }).filter(task => task !== null) as BackUpTask[];

        } catch (parseError) {
          console.error('Error parsing JSON:', parseError);
          return [];
        }

      });

  }

  private scriptPath(uuid: string): string {
    return path.join(
      process.env.ProgramData ?? 'C:\\ProgramData',
      'houston-backups',
      'scripts',
      `${TASK_ID}_${uuid}.bat`
    );
  }

  async schedule(
    task: BackUpTask,
    username: string,
    password: string
  ): Promise<{ stdout: string; stderr: string }> {
    await this.scheduleAllTasks([task], username, password);
    return Promise.resolve({stdout: "", stderr: ""})
  }

  runNow(task: BackUpTask): Promise<{ stdout: string; stderr: string }> {
    const taskName = `${TASK_ID}_${task.uuid}`;
    const powerShellScript = `Start-ScheduledTask -TaskName "${taskName}"`;

    return this.runScriptAdmin(powerShellScript, `run_task_${task.uuid}`)
      .then((result) => {
        if (result.stderr && result.stderr.trim() !== "") {
          return Promise.reject({
            message: `Scheduled task "${taskName}" may have failed to start.`,
            ...result,
          });
        }
        return result;
      })
      .catch((err: any) => {
        return Promise.reject({
          message: `Failed to start scheduled task "${taskName}"`,
          stdout: err?.stdout ?? "",
          stderr: err?.stderr ?? "",
          code: err?.code ?? "unknown",
        });
      });
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


  async scheduleAllTasks(
    tasks: BackUpTask[],
    username: string,
    password: string,
    onProgress?: (done: number, total: number, msg: string) => void
  ): Promise<void> {

    const scriptsDir = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'houston-backups', 'scripts');
    const credDir = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'houston-backups', 'credentials');

    const psLines: string[] = [
      `# Backup-Operators membership & rights`,
      `$user = "$env:USERNAME"`,
      `${this.addUserToBackupOperatorsGroup()}`,
      `${this.getAddBackupGroupsToLogOnBatchAndService()}`,

      `New-Item -ItemType Directory -Force -Path "${scriptsDir}" | Out-Null`,
      `New-Item -ItemType Directory -Force -Path "${credDir}"   | Out-Null`
    ];

    tasks.forEach((t, idx) => {
      console.log(t)

      const [smbHost, smbSharePath] = t.target.split(':');
      const smbShare = smbSharePath.split('/')[0];
      // const target = getSmbTargetFromSmbTarget(task.target);
      t.host = smbHost;
      t.share = smbShare;

      const credFile = path.join(credDir, `${smbShare}.cred`).replace(/\\/g, '\\\\');
      const batPathEsc = this.scriptPath(t.uuid).replace(/\\/g, '\\\\');

      /* 1️⃣  cred file (idempotent) */
      psLines.push(`"username=${username}\n` + `" | Out-File -Encoding ascii -NoNewline -Force "${credFile}"`);
      psLines.push(`"password=${password}` + `" | Out-File -Append  -Encoding ascii "${credFile}"`);

      /* 2️⃣  BAT file */
      const batTxt = this.buildActionBat(t);
      psLines.push(`[IO.File]::WriteAllText("${batPathEsc}", @'\n${batTxt}\n'@)`);

      /* 3️⃣  ScheduledTask */
      psLines.push(this.scheduleToTaskTrigger(t.schedule));

      if (t.schedule.repeatFrequency == 'month'){

        psLines.push(`
          $TASK_TRIGGER_MONTHLY = 4
          $TASK_ACTION_EXEC = 0
          $TASK_CREATE_OR_UPDATE = 6
          $TASK_LOGON_S4U = 2
          $TASK_RUNLEVEL_HIGHEST = 1

          # 1.) Connect to the scheduler
          $svc = New-Object -ComObject "Schedule.Service"
          $svc.Connect()

          # 2.) Grab the root task folder and create a new TaskDefinition
          $root = $svc.GetFolder("\\")
          $task = $svc.NewTask(0)

          # 3.) Principal: use current user via S4U, with highest run level
          $principal = $task.Principal
          $principal.UserId = $env:USERNAME
          $principal.LogonType = $TASK_LOGON_S4U
          $principal.RunLevel = $TASK_RUNLEVEL_HIGHEST

          # 4.) Task metadata
          $task.RegistrationInfo.Description = "45 drives backup task"
          $task.Settings.Enabled = $true

          # 5.) Action execute .bat
          $action = $task.Actions.Create(0)
          $action.Path = "${batPathEsc}"

          # 6.) Trigger: Monthly
          $triggers = $task.Triggers
          $trigger = $triggers.Create(4)
          $trigger.StartBoundary = "${formatDateForTask2(t.schedule.startDate)}"
          $trigger.DaysOfMonth = 1
          $trigger.MonthsOfYear = 0x0FFF

          # 7.) Register the task (no password needed for S4U)
          $root.RegisterTaskDefinition(
            "${TASK_ID}_${t.uuid}",
            $task,
            $TASK_CREATE_OR_UPDATE,
            $env:USERNAME,
            $null,
            $TASK_LOGON_S4U
          )
          `)
      } else {
        psLines.push(`
          $act  = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/C "{0}"' -f "${batPathEsc}")
          $prin = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType S4U -RunLevel Highest
          Register-ScheduledTask -TaskName "${TASK_ID}_${t.uuid}" -Action $act -Trigger $taskTrigger -Principal $prin
        `);
      }

      // progress ping (harmless in PS if nobody is listening)
      if (onProgress) psLines.push(`Write-Host "PROGRESS:${idx + 1}"`);
    });

    await this.runScriptAdmin(psLines.join('\n'), 'bulk_schedule');

    if (onProgress) onProgress(tasks.length, tasks.length, 'All tasks scheduled');
  }
  

  /**
 * Creates the literal text of the .bat file that a Scheduled Task will run.
 * We keep it in one place so both `schedule()` and `scheduleAllTasks()` use the
 * exact same payload.
 */
  private buildActionBat(
    task: BackUpTask
  ): string {
    const mountBat = getMountSmbScript();

    const credFile = path.join(
      process.env.ProgramData || 'C:\\ProgramData',
      'houston-backups',
      'credentials',
      `${task.share}.cred`
    );

    // remove any leading "\" so drive:\<path> is well-formed 
    const rawDst = getSmbTargetFromSmbTarget(task.target)
      .replace(/\//g, '\\')
      .replace(/^\\/, '');

    const logFile =
      '%ProgramData%\\houston-backups\\logs\\backup_task_' +
      task.uuid +
      '.log';

    return `
  @echo off
  setlocal enabledelayedexpansion
  :: --- Houston backup task metadata (for reference) ---
  :: uuid        = ${task.uuid}
  :: description = ${task.description}
  :: source      = ${task.source}
  :: target      = ${rawDst}
  :: mirror      = ${task.mirror}
  :: START_DATE  = ${task.schedule.startDate.toISOString()}
  :: SMB_HOST    = ${task.host}
  :: SMB_SHARE   = ${task.share}
  
  :: --- export all four params as env vars ---
  set "CRED_FILE=${credFile}"
  set "SMB_HOST=${task.host}"
  set "SMB_SHARE=${task.share}"
  
  :: turn delayed expansion on so we can use !VAR!
  setlocal EnableDelayedExpansion
  
  :: --- prepare paths ---
  set "LOG=${logFile}"
  set "SOURCE=${task.source}"
  set "DST_PATH=${rawDst}"
  set "mountBat=${mountBat}"
  set "NETWORK_PATH=\\\\!SMB_HOST!\\!SMB_SHARE!"
  
  :: --- ensure log directory ---
  if not exist "%ProgramData%\\houston-backups\\logs" (
    mkdir "%ProgramData%\\houston-backups\\logs"
  )
  
  :: --- run everything inside a single redirect block ---
  echo ==========================================================
  echo [!date! !time!]  START  ${task.uuid}
  echo  Source      : !SOURCE!
  echo  Target      : !DST_PATH!
  echo  NetworkPath : !NETWORK_PATH!
  echo ----------------------------------------------------------

  :: --- DEBUG: show exactly what we're about to run ---
  echo [DEBUG] mount command: cmd /c ""!mountBat!" "!SMB_HOST!" "!SMB_SHARE!" "!CRED_FILE!"" >> "%LOG%" 2>&1

  :: --- actually run it & capture JSON + stderr ---
  set "TEMP_JSON=%TEMP%\mount_result_%RANDOM%.txt"
  cmd /c ""!mountBat!" "!SMB_HOST!" "!SMB_SHARE!" "!CRED_FILE!"" > "!TEMP_JSON!" 2>&1

  :: Debug
  echo [DEBUG] mount output: >> "%LOG%"
  type "!TEMP_JSON!" >> "%LOG%"
  echo !TEMP_JSON!

  :: Extract line with DriveLetter
  set "json="
  for /f "delims=" %%L in ('findstr "DriveLetter" "!TEMP_JSON!"') do (
      call set "json=%%L"
  )

  echo !json!

  :: Write json to temp file
  echo !json! > "%TEMP%\__extract.json"

  :: Extract drive letter
  for /f "tokens=2 delims=:" %%a in ('findstr /i "DriveLetter" "%TEMP%\__extract.json"') do (
      set "temp=%%a"
  )

  set "temp=!temp:"=!"
  set "temp=!temp: =!"
  set "drive=!temp:~0,1!"

  echo !drive!
  :: Clean up temp file
  del "%TEMP%\__extract.json" >nul 2>&1

  :: Build DEST
  set "DEST=!drive!:\!DST_PATH!"

  echo !DEST!

  rem --- copy payload with robocopy ---
  mkdir "!DEST!" 2>nul
  echo [INFO] Running robocopy ...
  robocopy "!SOURCE!" "!DEST!" /E /Z /FFT /R:2 /W:5 /V /NP
  set "RC=!errorlevel!"

  rem --- clean up the mapping ---
  timeout /t 2 >nul
  net use !drive!: /delete /y >> "%LOG%" 2>&1

  rem --- interpret robocopy return codes ---
  rem Exit codes: 0 = no copy needed, 1 = some files copied, 8+ = errors
  if !RC! GEQ 8 (
    echo [ERROR] robocopy returned !RC! >> "%LOG%" 2>&1
    exit /b !RC!
  ) else (
    echo [INFO] robocopy completed with code !RC! >> "%LOG%" 2>&1
  )

  :: --- final exit ---
  echo [!date! !time!]  END    rc=!RC! >> "!LOG!" 2>&1
  exit /b !RC!
  `.trimStart();
  }
  

  async unschedule(task: BackUpTask): Promise<void> {
    const { bat, log, cred } = this.getTaskPaths(task);

    // one PS script to both unregister and delete
    const ps = `
    # unregister the scheduled task
    if (Get-ScheduledTask -TaskName "${TASK_ID}_${task.uuid}" -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName "${TASK_ID}_${task.uuid}" -Confirm:$false
    }

    # delete the on-disk artifacts
    Remove-Item -Path "${bat}"   -Force -ErrorAction SilentlyContinue
    # Remove-Item -Path "${log}"   -Force -ErrorAction SilentlyContinue

    # prune the credential file if no other task uses it
    $share = "${task.share}"
    $inUse = (Get-ScheduledTask | Where-Object TaskName -like "*${TASK_ID}_*" `
      + `| ForEach-Object { $_.TaskName.Split('_')[-1] } `
      + `| Where-Object { $_ -eq "${task.uuid}" }).Count -gt 0
    if (-not $inUse) {
      Remove-Item -Path "${cred}" -Force -ErrorAction SilentlyContinue
    }
  `;

    await this.runScriptAdmin(ps, `unschedule_and_cleanup_${task.uuid}`);
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

  /** Unschedule & clean up MANY tasks in one go */
  async unscheduleSelectedTasks(tasks: BackUpTask[]): Promise<void> {
    // build PS lines to unregister each task
    const unregisterLines = tasks.map(t =>
      `if (Get-ScheduledTask -TaskName "${TASK_ID}_${t.uuid}" -ErrorAction SilentlyContinue) { ` +
      `Unregister-ScheduledTask -TaskName "${TASK_ID}_${t.uuid}" -Confirm:$false }`
    );

    // collect all file paths
    const bats = tasks.map(t => `"${this.getTaskPaths(t).bat}"`);
    const logs = tasks.map(t => `"${this.getTaskPaths(t).log}"`);
    const creds = Array.from(
      new Set(tasks.map(t => this.getTaskPaths(t).cred))
    ).map(p => `"${p}"`);

    // combine into one PS blob
    const ps = [
      '# — unregister all selected tasks',
      ...unregisterLines,
      '',
      '# — delete .bat scripts',
      `Remove-Item -Path ${bats.join(', ')} -Force -ErrorAction SilentlyContinue`,
      '',
      // '# — delete .log files',
      // `Remove-Item -Path ${logs.join(', ')} -Force -ErrorAction SilentlyContinue`,
      '',
      '# — delete orphaned .cred files',
      `Remove-Item -Path ${creds.join(', ')} -Force -ErrorAction SilentlyContinue`
    ].join('\n');

    // run it once as admin
    await this.runScriptAdmin(ps, 'bulk_unschedule_and_cleanup');
  }



  protected scheduleToTaskTrigger(sched: TaskSchedule): string {
    const startDate = formatDateForTask(sched.startDate); // e.g., "2025-02-25 10:00:00"
    switch (sched.repeatFrequency) {
      case "hour":
        return `
$startTime   = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -Once -At $startTime
$taskTrigger.Repetition.Interval  = "PT1H"
$taskTrigger.Repetition.Duration  = "P100Y"
`;
      case "day":
        return `
$startTime = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -At $startTime -Daily
`;
      case "week":
        return `
$startTime = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -At $startTime -Daily -DaysInterval 7
`;
      case "month":
        return ""
    }
  }

  async updateSchedule(task: BackUpTask, username: string, password: string): Promise<void> {
    const taskName = `${TASK_ID}_${task.uuid}`;

    const deleteScript = `
if (Get-ScheduledTask -TaskName "${taskName}" -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName "${taskName}" -Confirm:$false
} else {
  Write-Host "⚠ Task '${taskName}' not found — skipping delete"
}
`;

    try {
      // Step 1: Remove old version
      await this.runScriptAdmin(deleteScript, `delete_${task.uuid}`);

      // Step 2: Recreate with new schedule
      await this.schedule(task, username, password); // Provide actual username/password if required
    } catch (err) {
      console.error(`❌ Failed to update schedule for ${taskName}:`, err);
      throw new Error(`Failed to update task: ${err instanceof Error ? err.message : String(err)}`);
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
          if (startBoundaryMatch) {
            startBoundaryMatch = startBoundaryMatch[1]
          }
          hoursIntervalMatch = cimProperties.match(/HoursInterval\s*=\s*(\d+)/);
          if (startBoundaryMatch) {
            hoursIntervalMatch = hoursIntervalMatch[1]
          }
          daysIntervalMatch = cimProperties.match(/DaysInterval\s*=\s*(\d+)/);
          if (startBoundaryMatch) {
            daysIntervalMatch = daysIntervalMatch[1]
          }
          weeksIntervalMatch = cimProperties.match(/WeeksInterval\s*=\s*(\d+)/);
          if (startBoundaryMatch) {
            weeksIntervalMatch = weeksIntervalMatch[1]
          }
          monthsIntervalMatch = cimProperties.match(/MonthsInterval\s*=\s*(\d+)/);
          if (startBoundaryMatch) {
            monthsIntervalMatch = monthsIntervalMatch[1]
          }
        } else if (Array.isArray(cimProperties)) {
          for (const prop of cimProperties) {
            if (prop.Name === "StartBoundary") {
              startBoundaryMatch = prop.Value;
            }
            else if (prop.Name === "HoursInterval") {
              hoursIntervalMatch = prop.Value;
            }
            else if (prop.Name === "DaysInterval") {
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
              startDate: new Date(startBoundaryMatch),
            };

          } else if (daysIntervalMatch) {

            return {
              repeatFrequency: 'day',
              startDate: new Date(startBoundaryMatch),
            };

          } else if (weeksIntervalMatch) {

            return {
              repeatFrequency: 'week',
              startDate: new Date(startBoundaryMatch),
            };

          } else if (monthsIntervalMatch) {

            return {
              repeatFrequency: 'month',
              startDate: new Date(startBoundaryMatch),
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

  protected parseBackupCommand(command: string): TaskData | null {
    try {

      command = command.replace("/C ", '').replace("\"", "").replace("\"", "").trim();

      // console.log(command)
      // Path to your .bat file
      const batFilePath = command;
      /* ----- bail out early if the target BAT is gone ----- */
      if (!fs.existsSync(batFilePath)) {
        log.warn(`[parseBackupCommand] BAT not found → skip task: ${batFilePath}`);
        return null;
      }
      
      // Read the file
      const content = fs.readFileSync(batFilePath, 'utf8');

      // Initialize object to hold extracted variables
      const task: TaskData = {};

      // Regular expression to match the lines
      const regex = /^\s*::\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/gm;

      let match;
      while ((match = regex.exec(content)) !== null) {
        const key = match[1];
        let value = match[2];

        // Clean up value if needed (e.g., remove ${} if still present)
        value = value.replace(/^\${|}$/g, '');

        (task as any)[key] = value;
      }

      return task;

    } catch (parseError) {
      console.error('Error regex:', parseError);
      console.error('String value was:', command);
      return null;
    }
  }
}
