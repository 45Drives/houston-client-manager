import { jsonLogger } from '../main';
import { BackUpManager, BackupProgressCallback } from "./types";
import { BackUpTask, TaskSchedule } from "@45drives/houston-common-lib";
import { formatDateForTask, getAppPath, getMountSmbScript, getSmbTargetFromSmbTarget } from "../utils";
import sudo from 'sudo-prompt';
import path from "path";
import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import { exec } from "child_process";
import { assertSafeHost, assertSafeShare, assertSafeUsername, escapeCmdValue, toBase64 } from "../security";
import { getCredentialManager } from '../credentialManager';

const TASK_ID = "Houston_Backup_Task";
const logPath = path.join(app.getPath('userData'), 'logs');

/* Per-user storage to avoid admin prompts for file IO.
* Scripts & creds live under %LOCALAPPDATA%\houston-backups\...
* Logs stay under app.getPath('userData') as before. */
const USER_LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const HOUSTON_USER_DIR = path.join(USER_LOCALAPPDATA, 'houston-backups');
const SCRIPTS_DIR = path.join(HOUSTON_USER_DIR, 'scripts');
const CREDS_DIR = path.join(HOUSTON_USER_DIR, 'credentials');

interface TaskData {
  source?: string;
  target?: string;
  description?: string;
  mirror?: boolean;
  schedule?: string;
  uuid?: string;
  SMB_HOST?: string;
  SMB_SHARE?: string;
  SMB_USER?: string;
  START_DATE?: string;
  [key: string]: string | boolean | undefined;
}

export class BackUpManagerWin implements BackUpManager {

  protected runScriptAdmin(powershellScript: string, scriptName: string): Promise<{ stdout: string, stderr: string }> {
    const options = {
      name: '45Drives Storage Wizard'
    };

    // Save to file
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `${scriptName}.ps1`);
    console.debug("running: " + scriptPath);
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
    const share = task.share || task.target.split(":")[1].split("/")[0];
    const host = task.host || task.target.split(':')[0];
    const user = task.smb_user || '';
    const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');
    const key = `${safe(host)}_${safe(share)}_${safe(user)}`;
    return {
      bat: path.join(SCRIPTS_DIR, `Houston_Backup_Task_${task.uuid}.bat`),
      log: path.join(logPath, `backup_task_${task.uuid}.log`), // logs under userData
      cred: path.join(CREDS_DIR, `${key}.cred`),
      share
    };
  }

  
  queryTasks(): Promise<BackUpTask[]> {
    const powerShellScript = `
    $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $meShort = $env:USERNAME
    Get-ScheduledTask |
      Where-Object {
        $_.TaskName -like '*${TASK_ID}*' -and
        ($_.Principal.UserId -eq $me -or $_.Principal.UserId -eq $meShort)
      } |
      Select-Object TaskName, Triggers, Actions, State, Principal |
      ConvertTo-Json -Depth 10
  `;

    return this.runScript(powerShellScript, "query_tasks")
      .then(result => {
        if (!result.stdout || !result.stdout.trim()) {
          return [];
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
              console.debug("No Command:", actionProps);
              return null;
            }

            const actionDetails = this.parseBackupCommand(command);
            if (!actionDetails) {
              console.debug("task.Actions:", command);
              return null;
            }

            const trigger = this.convertTriggersToTaskSchedule(task.Triggers);
            if (!trigger) {
              console.debug("Failed to parse Trigger:", task.Triggers);
              return null;
            }

            const backUpTask: BackUpTask = {
              uuid: actionDetails.uuid!,
              description: actionDetails.description!,
              name: actionDetails.name as string || undefined,
              schedule: trigger!,
              source: actionDetails.source!,
              target: actionDetails.target!,
              mirror: actionDetails.mirror === true,
              host: actionDetails.SMB_HOST,
              share: actionDetails.SMB_SHARE,
              status: "checking",
              smb_user: actionDetails.SMB_USER,
            };

            if (actionDetails.START_DATE) {
              backUpTask.schedule.startDate = new Date(actionDetails.START_DATE);
            }

            return backUpTask;
          }).filter(t => t !== null) as BackUpTask[];

        } catch (parseError) {
          console.error('Error parsing JSON:', parseError);
          return [];
        }
      });
  }


  private scriptPath(uuid: string): string {
    // Store scripts in per-user %LOCALAPPDATA%\houston-backups\scripts
    return path.join(
      SCRIPTS_DIR,
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

  async runNow(task: BackUpTask, onProgress?: BackupProgressCallback): Promise<{ stdout: string; stderr: string }> {
    const taskName = `${TASK_ID}_${task.uuid}`;
    const logFile = path.join(logPath, `Houston_Backup_Task_${task.uuid}.log`);
    const ps = `Start-ScheduledTask -TaskName "${taskName}"`;

    // Record log file size before running so we can read only new content
    let logSizeBefore = 0;
    try { logSizeBefore = fs.statSync(logFile).size; } catch {}

    onProgress?.(null, 'Starting scheduled task...');

    // 1) Try without elevation first
    try {
      const res = await this.runScript(ps, `run_task_${task.uuid}_user`);
      if (res.stderr && res.stderr.trim() !== "") {
        throw Object.assign(new Error(`User-mode start produced stderr`), { res });
      }
    } catch (e: any) {
      // 2) Fallback to admin
      try {
        const adminRes = await this.runScriptAdmin(ps, `run_task_${task.uuid}_admin`);
        if (adminRes.stderr && adminRes.stderr.trim() !== "") {
          throw Object.assign(new Error(`Admin start produced stderr`), { res: adminRes });
        }
      } catch (adminErr: any) {
        // 3) Bubble a clear error if both paths fail
        const u = (e && e.res) ? e.res : { stdout: "", stderr: "", code: "unknown" };
        const a = (adminErr && adminErr.res) ? adminErr.res : { stdout: "", stderr: "", code: "unknown" };
        throw {
          message: `Failed to start scheduled task "${taskName}" (user & admin)`,
          userStdout: u.stdout ?? "",
          userStderr: u.stderr ?? (u.error ?? ""),
          adminStdout: a.stdout ?? "",
          adminStderr: a.stderr ?? (a.error ?? ""),
          code: adminErr?.code ?? e?.code ?? "unknown",
        };
      }
    }

    // 4) Poll for task completion (Start-ScheduledTask is fire-and-forget)
    const pollPs = `(Get-ScheduledTask -TaskName "${taskName}").State`;
    const maxWaitMs = 30 * 60 * 1000; // 30 minutes
    const pollIntervalMs = 3000;
    const startTime = Date.now();
    let timedOut = false;

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(r => setTimeout(r, pollIntervalMs));

      // Emit progress based on latest log content
      if (onProgress) {
        try {
          const currentSize = fs.statSync(logFile).size;
          if (currentSize > logSizeBefore) {
            const buf = Buffer.alloc(currentSize - logSizeBefore);
            const fd = fs.openSync(logFile, 'r');
            fs.readSync(fd, buf, 0, buf.length, logSizeBefore);
            fs.closeSync(fd);
            const newContent = buf.toString('utf8');
            if (newContent.includes('Running robocopy')) {
              onProgress(null, 'Copying files...');
            } else if (newContent.includes('Mapping')) {
              onProgress(null, 'Mounting share...');
            }
            // Parse robocopy /bytes output for file-level progress
            // Lines look like: \t   New File  \t\t  1234567 \t filename.ext
            // Or percentage lines:    42.3%
            const pctMatches = [...newContent.matchAll(/(\d+(?:\.\d+)?)%/g)];
            if (pctMatches.length > 0) {
              onProgress(Math.round(parseFloat(pctMatches[pctMatches.length - 1][1])), 'Copying files...');
            } else {
              // Count files processed for a rough indicator
              const fileLines = newContent.split('\n').filter(l => /^\t/.test(l) && !l.includes('---'));
              if (fileLines.length > 0) {
                onProgress(null, `Copied ${fileLines.length} files...`);
              }
            }
          }
        } catch { /* log file not yet written */ }
      }

      try {
        const stateRes = await this.runScript(pollPs, `poll_task_${task.uuid}`);
        const state = stateRes.stdout.trim();
        if (state !== 'Running' && state !== '4') {
          break;
        }
      } catch {
        break;
      }
    }
    if (Date.now() - startTime >= maxWaitMs) {
      timedOut = true;
    }

    // 5) Read new log content written during this run
    let logContent = '';
    try {
      const fullSize = fs.statSync(logFile).size;
      const newBytes = fullSize - logSizeBefore;
      if (newBytes > 0) {
        const buf = Buffer.alloc(newBytes);
        const fd = fs.openSync(logFile, 'r');
        fs.readSync(fd, buf, 0, newBytes, logSizeBefore);
        fs.closeSync(fd);
        logContent = buf.toString('utf8');
      }
    } catch {}

    if (timedOut) {
      return { stdout: logContent, stderr: '[ERROR] Backup task still running after 30 minutes' };
    }

    // 6) Check LastTaskResult (robocopy: 0-7 = success, 8+ = error)
    const resultPs = `(Get-ScheduledTaskInfo -TaskName "${taskName}").LastTaskResult`;
    let lastResult = 0;
    try {
      const resultRes = await this.runScript(resultPs, `result_task_${task.uuid}`);
      lastResult = parseInt(resultRes.stdout.trim(), 10) || 0;
    } catch {}

    if (lastResult >= 8) {
      return { stdout: logContent, stderr: `[ERROR] Task exited with code ${lastResult}` };
    }

    return { stdout: logContent, stderr: '' };
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

    const safeUser = assertSafeUsername(username);

    /* ── Phase 1: User-level file I/O (no admin needed) ─────────────── */
    fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
    fs.mkdirSync(CREDS_DIR,   { recursive: true });

    const batPaths: string[] = [];

    tasks.forEach((t) => {
      const [smbHostRaw, smbSharePath] = t.target.split(':');
      const smbHost = assertSafeHost(smbHostRaw);
      const smbShare = assertSafeShare(smbSharePath.split('/')[0]);
      t.host = smbHost;
      t.share = smbShare;

      // Store credential in encrypted vault
      getCredentialManager().store(smbHost, smbShare, username, password);

      // Write cred file (user-level %LOCALAPPDATA%)
      const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');
      const credKey = `${safe(smbHost)}_${safe(smbShare)}_${safe(safeUser)}`;
      const credFile = path.join(CREDS_DIR, `${credKey}.cred`);
      fs.writeFileSync(credFile, `username=${safeUser}\npassword=${password}\n`);

      // Write BAT file (user-level %LOCALAPPDATA%)
      const batPath = this.scriptPath(t.uuid);
      fs.writeFileSync(batPath, this.buildActionBat(t, username));
      batPaths.push(batPath);
    });

    /* ── Phase 2: Admin-only (group/policy setup + task registration) ── */
    const userB64 = toBase64(safeUser);
    const passB64 = toBase64(password);

    const psLines: string[] = [
      `# Backup-Operators membership & rights`,
      `$user = "$env:USERNAME"`,
      `$userVal = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${userB64}"))`,
      `$passVal = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${passB64}"))`,
      `${this.addUserToBackupOperatorsGroup()}`,
      `${this.getAddBackupGroupsToLogOnBatchAndService()}`
    ];

    tasks.forEach((t, idx) => {
      const batPathEsc = this.scriptPath(t.uuid).replace(/\\/g, '\\\\');

      /* ScheduledTask registration (requires admin for S4U) */
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
          $trigger.StartBoundary = "${formatDateForTask(t.schedule.startDate, true)}"
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
          `);
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
  private buildActionBat(task: BackUpTask, smbUser: string): string {
    const mountBat = getMountSmbScript();

    const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');
    const credKey = `${safe(task.host || '')}_${safe(task.share || '')}_${safe(smbUser)}`;
    const credFile = path.join(CREDS_DIR, `${credKey}.cred`);
    const rawDst = getSmbTargetFromSmbTarget(task.target)
      .replace(/\//g, '\\')
      .replace(/^\\/, '');

    const safeHost = escapeCmdValue(task.host || '');
    const safeShare = escapeCmdValue(task.share || '');
    const safeSource = escapeCmdValue(task.source || '');
    const safeDst = escapeCmdValue(rawDst);
    const safeSmbUser = escapeCmdValue(smbUser);

    const logFile = path.join(logPath, `Houston_Backup_Task_${task.uuid}.log`);
    const eventLog = path.join(logPath, `45drives_backup_events.json`);

    return `
@echo off
setlocal enabledelayedexpansion

:: --- Houston backup task metadata (for queryTasks) -------------------------
:: uuid        = ${task.uuid}
:: description = ${task.description}
:: name        = ${task.name || ''}
:: source      = ${task.source}
:: target      = ${rawDst}
:: mirror      = ${task.mirror}
:: START_DATE  = ${task.schedule.startDate.toISOString()}
:: SMB_HOST    = ${task.host}
:: SMB_SHARE   = ${task.share}
:: SMB_USER    = ${smbUser}

:: identities and constants
set "CRED_FILE=${credFile.replace(/\\/g, '\\\\')}"
set "SMB_HOST=${safeHost}"
set "SMB_SHARE=${safeShare}"
set "SOURCE=${safeSource}"
set "DST_PATH=${safeDst}"
set "LOG=${logFile.replace(/\\/g, '\\\\')}"
set "EVENT_LOG=${eventLog.replace(/\\/g, '\\\\')}"
set "MOUNTBAT=${mountBat}"
set "NETWORK_PATH=\\\\!SMB_HOST!\\!SMB_SHARE!"
set "SMB_USER=${safeSmbUser}"

:: install_id from client-id.txt
set "CLIENT_ID_FILE=${path.join(app.getPath('userData'), 'client-id.txt').replace(/\\/g, '\\\\')}"
set "INSTALL_ID="
if exist "%CLIENT_ID_FILE%" for /f "usebackq delims=" %%I in ("%CLIENT_ID_FILE%") do set "INSTALL_ID=%%I"

:: fallback (if somehow SMB_USER was blank) read from cred file
if "%SMB_USER%"=="" (
  for /f "tokens=1,2 delims==" %%A in ('findstr /i "^username=" "%CRED_FILE%"') do (
    if /i "%%A"=="username" set "SMB_USER=%%B"
  )
)

:: ensure log directory
if not exist "${logPath.replace(/\\/g, '\\\\')}" mkdir "${logPath.replace(/\\/g, '\\\\')}"

:: timestamp(ISO 8601)
for /f "delims=" %%I in ('powershell -NoProfile -Command "Get-Date -Format o"') do set "TS=%%I"

:: --- backup_start (with install_id + smb_user) -----------------------------
>> "%EVENT_LOG%" echo {^"event^":^"backup_start^",^"timestamp^":^"!TS!^",^"uuid^":^"${task.uuid}"^,^"host^":^"${task.host}"^,^"share^":^"${task.share}"^,^"source^":^"${task.source}"^,^"target^":^"${rawDst}"^,^"install_id^":^"!INSTALL_ID!"^,^"smb_user^":^"!SMB_USER!"^}

echo ==========================================================
echo [!date! !time!]  START  ${task.uuid}
echo  Source      : !SOURCE!
echo  Target      : !DST_PATH!
echo  NetworkPath : !NETWORK_PATH!
echo ----------------------------------------------------------

:: --- mount SMB and extract drive letter via the helper ---------------------
echo [DEBUG] mount command: cmd /c ""%MOUNTBAT%" "!SMB_HOST!" "!SMB_SHARE!" "!CRED_FILE!"" >> "%LOG%" 2>&1

set "TEMP_JSON=%TEMP%\\mount_result_%RANDOM%.txt"
cmd /c ""%MOUNTBAT%" "!SMB_HOST!" "!SMB_SHARE!" "!CRED_FILE!"" > "!TEMP_JSON!" 2>&1

echo [DEBUG] mount output: >> "%LOG%"
type "!TEMP_JSON!" >> "%LOG%"

set "json="
for /f "delims=" %%L in ('findstr "DriveLetter" "!TEMP_JSON!"') do (
  call set "json=%%L"
)
del "!TEMP_JSON!" >nul 2>&1

echo !json! > "%TEMP%\\__extract.json"
for /f "tokens=2 delims=:" %%a in ('findstr /i "DriveLetter" "%TEMP%\\__extract.json"') do set "temp=%%a"
set "temp=!temp:"=!"
set "temp=!temp: =!"
set "drive=!temp:~0,1!"
del "%TEMP%\\__extract.json" >nul 2>&1

if not defined drive (
  echo [ERROR] Could not determine drive letter >> "%LOG%" 2>&1
  set "RC=8"
  goto :_finish
)

set "DEST=!drive!:\\!DST_PATH!"
echo [DEBUG] DEST=!DEST! >> "%LOG%"

:: ---- marker: write install_id + smb_user at \\UUID\\.houston\\client.json --
for /f "tokens=1 delims=\\" %%U in ("!DST_PATH!") do set "UUID=%%U"
set "MARKER_DIR=!drive!:\\!UUID!\\.houston"
if not exist "!MARKER_DIR!" mkdir "!MARKER_DIR!"
set "JSON_SOURCE=!SOURCE:\=\\!"
> "!MARKER_DIR!\\client.json" echo {"install_id":"!INSTALL_ID!","smb_user":"!SMB_USER!","source":"!JSON_SOURCE!","user":"%USERNAME%","host":"%COMPUTERNAME%","platform":"win"}

:: --- copy payload ----------------------------------------------------------
mkdir "!DEST!" 2>nul
echo [INFO] Running robocopy ...
robocopy "!SOURCE!" "!DEST!" /E /Z /FFT /R:2 /W:5 /V /NJH /bytes
set "RC=!errorlevel!"

:_finish
:: --- backup_end (with install_id + smb_user) -------------------------------
for /f "delims=" %%I in ('powershell -NoProfile -Command "Get-Date -Format o"') do set "TS2=%%I"
set "STATUS="
if !RC! GEQ 8 (set STATUS=failure) else (set STATUS=success)
>> "%EVENT_LOG%" echo {^"event^":^"backup_end^",^"timestamp^":^"!TS2!^",^"uuid^":^"${task.uuid}"^,^"host^":^"${task.host}"^,^"share^":^"${task.share}"^,^"source^":^"${task.source}"^,^"target^":^"${rawDst}"^,^"status^":^"!STATUS!"^,^"install_id^":^"!INSTALL_ID!"^,^"smb_user^":^"!SMB_USER!"^}

:: --- clean up mapping + exit code interpretation ---------------------------
timeout /t 2 >nul
if defined drive net use !drive!: /delete /y >> "%LOG%" 2>&1

if !RC! GEQ 8 (
  echo [ERROR] robocopy returned !RC! >> "%LOG%" 2>&1
  exit /b !RC!
) else (
  echo [INFO] robocopy completed with code !RC! >> "%LOG%" 2>&1
)
echo [!date! !time!]  END    rc=!RC! >> "%LOG%" 2>&1
exit /b !RC!
`.trimStart();
  }


  async unschedule(task: BackUpTask): Promise<void> {
    const { bat, cred } = this.getTaskPaths(task);

    const batEsc = bat.replace(/\\/g, '\\\\');
    const credEsc = cred.replace(/\\/g, '\\\\');
    const scriptsDirEsc = SCRIPTS_DIR.replace(/\\/g, '\\\\');
    const taskName = `${TASK_ID}_${task.uuid}`;

    const ps = `
$ErrorActionPreference = 'Stop'

# 1) Unregister the scheduled task if it exists
$t = Get-ScheduledTask -TaskName "${taskName}" -ErrorAction SilentlyContinue
if ($t) {
  Unregister-ScheduledTask -TaskName "${taskName}" -Confirm:$false -ErrorAction Stop
}

# 2) Remove the BAT script for this task
Remove-Item -Path "${batEsc}" -Force -ErrorAction SilentlyContinue

# 3) Remove the credential file only if no other BAT references the same cred path
$credPath = "${credEsc}"
$credInUse = $false
try {
  $otherBats = Get-ChildItem -Path "${scriptsDirEsc}" -Filter "Houston_Backup_Task_*.bat" -ErrorAction SilentlyContinue
  foreach ($b in $otherBats) {
    if (Select-String -Path $b.FullName -Pattern $credPath -SimpleMatch -Quiet) {
      $credInUse = $true
      break
    }
  }
} catch {}

if (-not $credInUse) {
  Remove-Item -Path $credPath -Force -ErrorAction SilentlyContinue
}
`.trim();

    // Try without elevation first; fallback to admin only if needed
    try {
      await this.runScript(ps, `unschedule_and_cleanup_${task.uuid}_user`);
    } catch {
      try {
        await this.runScriptAdmin(ps, `unschedule_and_cleanup_${task.uuid}_admin`);
      } catch (adminErr) {
        console.warn(`unschedule: both user and admin PS failed for ${task.uuid}`, adminErr);
      }
    }

    // Fallback: ensure the BAT file is removed from disk even if PS failed.
    // This guarantees the task won't reappear in queryTasks.
    try {
      if (fs.existsSync(bat)) fs.unlinkSync(bat);
    } catch (e) {
      console.warn(`unschedule: failed to remove BAT file: ${bat}`, e);
    }
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

  async unscheduleSelectedTasks(tasks: BackUpTask[]): Promise<void> {
    if (!tasks || tasks.length === 0) return;

    const scriptsDirEsc = SCRIPTS_DIR.replace(/\\/g, '\\\\');

    // Build lists for PS
    const taskNames = tasks.map(t => `${TASK_ID}_${t.uuid}`);
    const bats = tasks.map(t => this.getTaskPaths(t).bat);
    const creds = tasks.map(t => this.getTaskPaths(t).cred);

    // Escape for PS array literals
    const psTaskNames = taskNames.map(s => `"${s}"`).join(', ');
    const psBats = bats.map(p => `"${p.replace(/\\/g, '\\\\')}"`).join(', ');
    const psCreds = creds.map(p => `"${p.replace(/\\/g, '\\\\')}"`).join(', ');

    const ps = `
$ErrorActionPreference = 'Stop'

# Inputs
$TaskNames = @(${psTaskNames})
$BatPaths  = @(${psBats})
$CredPaths = @(${psCreds})

# 1) Unregister all selected tasks
foreach ($tn in $TaskNames) {
  $t = Get-ScheduledTask -TaskName $tn -ErrorAction SilentlyContinue
  if ($t) {
    Unregister-ScheduledTask -TaskName $tn -Confirm:$false -ErrorAction Stop
  }
}

# 2) Delete their BAT scripts
if ($BatPaths.Length -gt 0) {
  try { Remove-Item -Path $BatPaths -Force -ErrorAction SilentlyContinue } catch {}
}

# 3) For each cred file, delete only if no remaining BAT references it
try {
  $remainingBats = @()
  try { $remainingBats = Get-ChildItem -Path "${scriptsDirEsc}" -Filter "Houston_Backup_Task_*.bat" -ErrorAction SilentlyContinue } catch {}

  foreach ($credPath in $CredPaths) {
    $inUse = $false
    $credEscaped = [regex]::Escape($credPath)
    foreach ($b in $remainingBats) {
      if (Select-String -Path $b.FullName -Pattern $credEscaped -SimpleMatch -Quiet) {
        $inUse = $true
        break
      }
    }

    if (-not $inUse) {
      try { Remove-Item -Path $credPath -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
} catch {}
`.trim();

    try {
      await this.runScript(ps, 'bulk_unschedule_and_cleanup_user');
    } catch {
      try {
        await this.runScriptAdmin(ps, 'bulk_unschedule_and_cleanup_admin');
      } catch (adminErr) {
        console.warn(`unscheduleSelectedTasks: both user and admin PS failed`, adminErr);
      }
    }

    // Fallback: ensure BAT files are removed from disk even if PS failed.
    // This guarantees the tasks won't reappear in queryTasks.
    for (const bat of bats) {
      try {
        if (fs.existsSync(bat)) fs.unlinkSync(bat);
      } catch (e) {
        console.warn(`unscheduleSelectedTasks: failed to remove BAT file: ${bat}`, e);
      }
    }
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
$ErrorActionPreference = 'Stop'
if (Get-ScheduledTask -TaskName "${taskName}" -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName "${taskName}" -Confirm:$false -ErrorAction Stop
} else {
  Write-Host "Task '${taskName}' not found - skipping delete"
}
`;

    try {
      // Step 1: Remove old version (try user-level first, fallback to admin)
      try {
        await this.runScript(deleteScript, `delete_${task.uuid}_user`);
      } catch {
        await this.runScriptAdmin(deleteScript, `delete_${task.uuid}_admin`);
      }

      // Step 2: Recreate with new schedule
      await this.schedule(task, username, password);
    } catch (err) {
      console.error(` Failed to update schedule for ${taskName}:`, err);
      throw new Error(`Failed to update task: ${err instanceof Error ? err.message : String(err)}`);
    }
  }


  protected convertTriggersToTaskSchedule(triggers: Record<string, unknown>[]): TaskSchedule | null {
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
        } else if (cimProperties && typeof cimProperties === 'object') {
          const props = cimProperties as Record<string, unknown>;
          startBoundaryMatch = props.StartBoundary;
          hoursIntervalMatch = props.HoursInterval;
          daysIntervalMatch = props.DaysInterval;
          weeksIntervalMatch = props.WeeksInterval;
          monthsIntervalMatch = props.MonthsInterval;
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
        return triggersArray[0] as TaskSchedule;
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

      // Path to your .bat file
      const batFilePath = command;
      /* ----- bail out early if the target BAT is gone ----- */
      if (!fs.existsSync(batFilePath)) {
        jsonLogger.warn({ event: `[parseBackupCommand] BAT not found → skip task: ${batFilePath}` });
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

        task[key] = value;
      }

      return task;

    } catch (parseError) {
      console.error('Error regex:', parseError);
      console.error('String value was:', command);
      return null;
    }
  }
}
