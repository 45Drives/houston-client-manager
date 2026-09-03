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
import { assertSafeHost, assertSafeShare, assertSafeUsername, escapeCmdValue } from "../security";
import { getCredentialManager } from '../credentialManager';
import { syncBackupConfig, getClientId, batchEventSnippet } from './broadcasterApi';

const TASK_ID = "Houston_Backup_Task";
const logPath = path.join(app.getPath('userData'), 'logs');

/* Per-user storage to avoid admin prompts for file IO.
* Scripts & creds live under %LOCALAPPDATA%\houston-backups\...
* Logs stay under app.getPath('userData') as before. */
const USER_LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const HOUSTON_USER_DIR = path.join(USER_LOCALAPPDATA, 'houston-backups');
const SCRIPTS_DIR = path.join(HOUSTON_USER_DIR, 'scripts');
const CREDS_DIR = path.join(HOUSTON_USER_DIR, 'credentials');

/* Registration runs elevated, where $env:USERNAME is whichever admin answered the UAC
 * prompt rather than the person whose files are being backed up. Capture the real
 * desktop identity here, while the app is still unelevated. */
const DESKTOP_USER = `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`;

/* Carries the Windows account password to PowerShell without writing it into the temp
 * .ps1, which persists in %TEMP% and is readable by other local accounts. */
const WIN_PASS_ENV = 'HOUSTON_WIN_ACCOUNT_PASSWORD';

/* buildActionBat only runs when a task is scheduled, so fixes to the generated
 * script never reach tasks that already exist. Bump on every script change. */
const ACTION_BAT_VERSION = 4;

interface TaskData {
  source?: string;
  target?: string;
  description?: string;
  schedule?: string;
  uuid?: string;
  SMB_HOST?: string;
  SMB_SHARE?: string;
  SMB_USER?: string;
  START_DATE?: string;
  [key: string]: string | boolean | undefined;
}

/* exec() rejects with an Error whose message is just "Command failed", discarding the
 * PowerShell diagnostic that explains why. Keep both streams on the error object. */
function attachOutput(error: any, stdout: unknown, stderr: unknown): any {
  error.stdout = stdout === undefined ? '' : String(stdout);
  error.stderr = stderr === undefined ? '' : String(stderr);
  return error;
}

function describeFailure(e: any): string {
  return [e?.stderr, e?.stdout, e?.message]
    .map((s) => (s ? String(s).trim() : ''))
    .filter(Boolean)
    .join(' | ')
    .replace(/\s+/g, ' ')
    .slice(0, 1500);
}

export class BackUpManagerWin implements BackUpManager {

  /* Set by the configurator when the user supplied it. Kept in memory only — Task
   * Scheduler persists it as an LSA secret, so we must never write it to disk. */
  windowsAccountPassword = '';

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
        if (error) return reject(attachOutput(error, stdout, stderr));
        resolve({ stdout: stdout === undefined ? "" : stdout.toString(), stderr: stderr === undefined ? "" : stderr.toString() });
      });
    });

  }

  protected runScript(powershellScript: string, scriptName: string, env?: Record<string, string>): Promise<{ stdout: string, stderr: string }> {
    // Save to file
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `${scriptName}.ps1`);
    fs.writeFileSync(scriptPath, powershellScript);

    return new Promise((resolve, reject) => {
      exec(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, { env: { ...process.env, ...env } }, (error, stdout, stderr) => {
        if (error) return reject(attachOutput(error, stdout, stderr));
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
    /* Task Scheduler normalises the principal of an S4U task to a SID, so a
     * name-only comparison silently matches nothing. Compare against both. */
    const powerShellScript = `
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $me = $id.Name
    $meSid = $id.User.Value
    $meShort = $env:USERNAME
    Get-ScheduledTask |
      Where-Object {
        $_.TaskName -like '*${TASK_ID}*' -and
        ($_.Principal.UserId -eq $me -or $_.Principal.UserId -eq $meShort -or
         $_.Principal.UserId -eq $meSid -or $_.Principal.UserId -eq '${DESKTOP_USER}')
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
              disabled: actionDetails.disabled === 'true',
              schedule: trigger!,
              source: actionDetails.source!,
              target: actionDetails.target!,
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

  /* Task Scheduler runs whatever .bat is on disk, so rewriting a stale one here
   * also repairs the task's future scheduled runs, not just this manual one. */
  private refreshActionBat(task: BackUpTask): boolean {
    const batPath = this.scriptPath(task.uuid);
    let existing: string;
    try { existing = fs.readFileSync(batPath, 'utf8'); } catch { return false; }
    if (existing.includes(`:: SCRIPT_VER  = ${ACTION_BAT_VERSION}`)) return false;

    try {
      // The task arriving over IPC may have lost its Date type and SMB fields.
      const meta = this.parseBackupCommand(batPath) || {};
      fs.writeFileSync(batPath, this.buildActionBat({
        ...task,
        host: task.host || meta.SMB_HOST,
        share: task.share || meta.SMB_SHARE,
        schedule: { ...task.schedule, startDate: new Date(task.schedule.startDate) },
      }, task.smb_user || meta.SMB_USER || ''));
      jsonLogger.info({ event: 'backup:action-script-upgraded', uuid: task.uuid });
      return true;
    } catch (e: any) {
      jsonLogger.warn({ event: 'backup:action-script-upgrade-failed', uuid: task.uuid, error: e?.message });
      return false;
    }
  }

  async refreshAllTaskScripts(): Promise<number> {
    let count = 0;
    for (const task of await this.queryTasks()) {
      try {
        if (this.refreshActionBat(task)) count++;
      } catch { /* one bad task must not stop the rest */ }
    }
    return count;
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
    this.refreshActionBat(task);
    const logFile = path.join(logPath, `Houston_Backup_Task_${task.uuid}.log`);
    // robocopy writes to the self-capture file, not %LOG%, so progress lives here.
    const consoleFile = path.join(logPath, `Houston_Backup_Task_${task.uuid}.console.log`);
    const ps = `Start-ScheduledTask -TaskName "${taskName}"`;

    // Record log file size before running so we can read only new content
    let logSizeBefore = 0;
    try { logSizeBefore = fs.statSync(logFile).size; } catch {}
    let consoleSizeBefore = 0;
    try { consoleSizeBefore = fs.statSync(consoleFile).size; } catch {}

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
          const currentSize = fs.statSync(consoleFile).size;
          if (currentSize > consoleSizeBefore) {
            const buf = Buffer.alloc(currentSize - consoleSizeBefore);
            const fd = fs.openSync(consoleFile, 'r');
            fs.readSync(fd, buf, 0, buf.length, consoleSizeBefore);
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
              // /MT suppresses the percentage lines, so fall back to counting
              // robocopy's per-file status column.
              const fileLines = newContent.split('\n').filter(
                l => /^[\t ]+(New File|Newer|Older|Same|Changed|modified|new file|\*EXTRA File)\b/i.test(l)
              );
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

  /* S4U registration requires the desktop account to hold "Log on as a batch job".
   * Administrators hold it by default; standard users usually do not. Granting the
   * right directly is far narrower than the previous Backup Operators membership,
   * and it is the only operation in this class that genuinely needs elevation. */
  private grantBatchLogonRightScript(): string {
    return `
$ErrorActionPreference = 'Stop'
$account = "${DESKTOP_USER}"
$sid = (New-Object System.Security.Principal.NTAccount($account)).Translate([System.Security.Principal.SecurityIdentifier]).Value

$cfg = Join-Path $env:TEMP 'houston_secpol.cfg'
$db  = Join-Path $env:TEMP 'houston_secpol.sdb'
secedit /export /areas USER_RIGHTS /cfg $cfg | Out-Null

$content = Get-Content $cfg
$existing = ($content | Select-String '^SeBatchLogonRight').Line

if ($existing -and $existing -like "*$sid*") {
    Write-Output "HOUSTON_RIGHT_ALREADY_PRESENT"
} else {
    if ($existing) {
        $updated = "$existing,*$sid"
        $content = $content -replace '^SeBatchLogonRight\\s*=.*', $updated
    } else {
        $content += "SeBatchLogonRight = *$sid"
    }
    $content | Set-Content $cfg -Encoding Unicode
    secedit /configure /db $db /cfg $cfg /areas USER_RIGHTS /quiet
    Write-Output "HOUSTON_RIGHT_GRANTED"
}
Remove-Item $cfg, $db -ErrorAction SilentlyContinue
`;
  }

  /* Returns the uuids that are NOT present in Task Scheduler. PowerShell exits 0
   * on non-terminating errors, so registration success is never assumed. */
  private async findUnregisteredTasks(uuids: string[]): Promise<string[]> {
    const names = uuids.map(u => `'${TASK_ID}_${u}'`).join(',');
    const ps = `
$ErrorActionPreference = 'SilentlyContinue'
foreach ($n in @(${names})) {
  if (Get-ScheduledTask -TaskName $n) { Write-Output "OK:$n" } else { Write-Output "MISSING:$n" }
}
`;
    try {
      const { stdout } = await this.runScript(ps, 'verify_schedule');
      return uuids.filter(u => stdout.includes(`MISSING:${TASK_ID}_${u}`));
    } catch (e) {
      console.error('[BackUpManagerWin] verify_schedule failed', describeFailure(e));
      return uuids;
    }
  }

  /* Returns a short status for the failure diagnostic. The marker means "we already
   * spent the user's one UAC prompt", not "the right is definitely present" \u2014 so the
   * caller reports it rather than treating a skip as success. */
  private async ensureBatchLogonRight(): Promise<string> {
    const marker = path.join(HOUSTON_USER_DIR, '.batch-logon-granted');
    if (fs.existsSync(marker)) return 'skipped, marker already present';
    const { stdout } = await this.runScriptAdmin(this.grantBatchLogonRightScript(), 'grant_batch_logon');
    try { fs.writeFileSync(marker, `${DESKTOP_USER}\n${new Date().toISOString()}\n`); } catch { /* retry next time */ }
    return stdout.trim().replace(/\s+/g, ' ') || 'no output';
  }

  /* Some policies deny S4U registration to an unelevated caller outright (HRESULT
   * 0x80070005), which the batch-logon right alone does not resolve. Grant and register
   * in one elevated pass so the fallback costs a single prompt rather than two. */
  private elevatedFallbackScript(registrationScript: string): string {
    return `
try {
${this.grantBatchLogonRightScript()}
} catch {
  Write-Output "GRANTFAIL: $($_.Exception.Message)"
}

${registrationScript}
`;
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

      // store() also creates the server record, so the SMB creds never touch login creds
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

    /* ── Phase 2: Task registration (no elevation in the common case) ── */
    const buildRegistrationScript = (usePassword: boolean): string => {
    const psLines: string[] = [
      `$ErrorActionPreference = 'Stop'`,
    ];

    tasks.forEach((t, idx) => {
      const batPathEsc = this.scriptPath(t.uuid).replace(/\\/g, '\\\\');
      const taskName = `${TASK_ID}_${t.uuid}`;
      const body: string[] = [];

      body.push(this.scheduleToTaskTrigger(t.schedule));

      if (t.schedule.repeatFrequency == 'month'){

        body.push(`
          $TASK_TRIGGER_MONTHLY = 4
          $TASK_ACTION_EXEC = 0
          $TASK_CREATE_OR_UPDATE = 6
          $TASK_LOGON_S4U = 2
          $TASK_LOGON_PASSWORD = 1
          $TASK_RUNLEVEL_LUA = 0

          # 1.) Connect to the scheduler
          $svc = New-Object -ComObject "Schedule.Service"
          $svc.Connect()

          # 2.) Grab the root task folder and create a new TaskDefinition
          $root = $svc.GetFolder("\\")
          $task = $svc.NewTask(0)

          # 3.) Principal: desktop user, at the user's own privilege level
          $principal = $task.Principal
          $principal.UserId = "${DESKTOP_USER}"
          $principal.LogonType = ${usePassword ? '$TASK_LOGON_PASSWORD' : '$TASK_LOGON_S4U'}
          $principal.RunLevel = $TASK_RUNLEVEL_LUA

          # 4.) Task metadata
          $task.RegistrationInfo.Description = "45 drives backup task"
          $task.Settings.Enabled = $true
          # Defaults refuse to start on battery and skip triggers missed while powered off
          $task.Settings.DisallowStartIfOnBatteries = $false
          $task.Settings.StopIfGoingOnBatteries = $false
          $task.Settings.StartWhenAvailable = $true

          # 5.) Action execute .bat
          $action = $task.Actions.Create(0)
          $action.Path = "${batPathEsc}"

          # 6.) Trigger: Monthly
          $triggers = $task.Triggers
          $trigger = $triggers.Create(4)
          $trigger.StartBoundary = "${formatDateForTask(t.schedule.startDate, true)}"
          $trigger.DaysOfMonth = 1
          $trigger.MonthsOfYear = 0x0FFF

          # 7.) Register the task
          $root.RegisterTaskDefinition(
            "${TASK_ID}_${t.uuid}",
            $task,
            $TASK_CREATE_OR_UPDATE,
            "${DESKTOP_USER}",
            ${usePassword ? `$env:${WIN_PASS_ENV}` : '$null'},
            ${usePassword ? '$TASK_LOGON_PASSWORD' : '$TASK_LOGON_S4U'}
          )
          `);
      } else {
        body.push(`
          $act  = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/C "{0}"' -f "${batPathEsc}")
          # Defaults refuse to start on battery and skip triggers missed while powered off
          $set  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
${usePassword
  ? `          Register-ScheduledTask -TaskName "${taskName}" -Action $act -Trigger $taskTrigger -Settings $set -User "${DESKTOP_USER}" -Password $env:${WIN_PASS_ENV} -RunLevel Limited`
  : `          $prin = New-ScheduledTaskPrincipal -UserId "${DESKTOP_USER}" -LogonType S4U -RunLevel Limited
          Register-ScheduledTask -TaskName "${taskName}" -Action $act -Trigger $taskTrigger -Principal $prin -Settings $set`}
        `);
      }

      // progress ping (harmless in PS if nobody is listening)
      if (onProgress) body.push(`Write-Host "PROGRESS:${idx + 1}"`);

      /* Per-task try/catch: without it the first failure aborts every later task under
       * $ErrorActionPreference='Stop', and the reason never reaches the caller. */
      psLines.push(`
try {
${body.join('\n')}
  Write-Output "TASKOK:${taskName}"
} catch {
  Write-Output "TASKFAIL:${taskName}: $($_.Exception.Message)"
}
`);
    });

      return psLines.join('\n');
    };

    const uuids = tasks.map(t => t.uuid);
    const diagnostics: string[] = [];

    const attemptRegistration = async (label: string, script: string, elevated = false, env?: Record<string, string>): Promise<void> => {
      try {
        const { stdout, stderr } = elevated
          ? await this.runScriptAdmin(script, label)
          : await this.runScript(script, label, env);
        stdout.split(/\r?\n/)
          .filter(l => l.startsWith('TASKFAIL:') || l.startsWith('GRANTFAIL:'))
          .forEach(l => diagnostics.push(`[${label}] ${l.trim()}`));
        if (stderr.trim()) diagnostics.push(`[${label}] ${stderr.trim().replace(/\s+/g, ' ').slice(0, 1500)}`);
      } catch (e) {
        diagnostics.push(`[${label}] ${describeFailure(e)}`);
      }
    };

    let missing = uuids;

    /* Preferred path: stored-password logon. A standard user may register this for
     * themselves unelevated, unlike S4U, so it costs no UAC prompt at all. The secret
     * travels by environment variable so it never lands in the temp .ps1. */
    if (this.windowsAccountPassword) {
      await attemptRegistration(
        'bulk_schedule_password',
        buildRegistrationScript(true),
        false,
        { [WIN_PASS_ENV]: this.windowsAccountPassword }
      );
      missing = await this.findUnregisteredTasks(uuids);
    }

    const s4uScript = buildRegistrationScript(false);

    if (missing.length > 0) {
      await attemptRegistration('bulk_schedule', s4uScript);
      missing = await this.findUnregisteredTasks(uuids);
    }

    if (missing.length > 0) {
      /* Often just a missing batch-logon right, which is cheap to grant and lets every
       * later task register unelevated. */
      try {
        diagnostics.push(`[grant_batch_logon] ${await this.ensureBatchLogonRight()}`);
        await attemptRegistration('bulk_schedule_retry', s4uScript);
        missing = await this.findUnregisteredTasks(uuids);
      } catch (e) {
        diagnostics.push(`[grant_batch_logon] ${describeFailure(e)}`);
      }
    }

    if (missing.length > 0) {
      /* Degrade rather than fail: a working backup behind one UAC prompt beats a
       * setup that completes with nothing scheduled. */
      await attemptRegistration('bulk_schedule_elevated', this.elevatedFallbackScript(s4uScript), true);
      missing = await this.findUnregisteredTasks(uuids);
    }

    if (missing.length > 0) {
      const denied = diagnostics.some(d => /access is denied|0x80070005/i.test(d));
      const hint = denied
        ? ` Registration was denied for ${DESKTOP_USER}. Creating a task that runs while logged out requires ` +
          `administrator approval on this machine; the elevated retry was cancelled or also denied.`
        : '';
      const detail = diagnostics.length ? ` Details: ${diagnostics.join(' ;; ')}` : ' No PowerShell diagnostic was produced.';
      console.error('[BackUpManagerWin] registration failed', { missing, diagnostics });
      throw new Error(
        `Failed to register ${missing.length} of ${tasks.length} scheduled backup task(s). ` +
        `Unregistered task IDs: ${missing.join(', ')}.${hint}${detail}`
      );
    }

    // Sync all backup configs to broadcaster API (best-effort, non-blocking)
    const clientId = getClientId();
    for (const t of tasks) {
      const serverHost = t.host || t.target.split(':')[0];
      syncBackupConfig(serverHost, username, password, t, clientId).catch(() => {});
    }

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
    const consoleLog = path.join(logPath, `Houston_Backup_Task_${task.uuid}.console.log`);
    const eventLog = path.join(logPath, `45drives_backup_events.json`);

    return `
@echo off
setlocal enabledelayedexpansion

:: --- Houston backup task metadata (for queryTasks) -------------------------
:: uuid        = ${task.uuid}
:: description = ${task.description}
:: name        = ${task.name || ''}
:: disabled    = ${task.disabled ? 'true' : 'false'}
:: source      = ${task.source}
:: target      = ${rawDst}
:: START_DATE  = ${task.schedule.startDate.toISOString()}
:: SMB_HOST    = ${task.host}
:: SMB_SHARE   = ${task.share}
:: SMB_USER    = ${smbUser}
:: SCRIPT_VER  = ${ACTION_BAT_VERSION}

:: Task Scheduler discards stdout, so re-invoke ourselves with everything captured.
if not "%~1"=="__HOUSTON_RUN" (
  if not exist "${logPath.replace(/\\/g, '\\\\')}" mkdir "${logPath.replace(/\\/g, '\\\\')}"
  call "%~f0" __HOUSTON_RUN >> "${consoleLog.replace(/\\/g, '\\\\')}" 2>&1
  exit /b !errorlevel!
)

:: Skip execution if task is disabled
if "${task.disabled ? 'true' : 'false'}"=="true" (
  echo [INFO] Task is disabled, skipping.
  exit /b 0
)

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

:: Log viewer anchors every later line to this banner. %DATE%/%TIME% are locale
:: dependent, so the timestamp has to come from PowerShell.
>> "%LOG%" echo ===== [!TS!] Backup started =====

:: --- backup_start (with install_id + smb_user) -----------------------------
>> "%EVENT_LOG%" echo {^"event^":^"backup_start^",^"timestamp^":^"!TS!^",^"uuid^":^"${task.uuid}"^,^"host^":^"${task.host}"^,^"share^":^"${task.share}"^,^"source^":^"${task.source}"^,^"target^":^"${rawDst}"^,^"install_id^":^"!INSTALL_ID!"^,^"smb_user^":^"!SMB_USER!"^}

set "BACKUP_STATUS="
set "BACKUP_ERROR="
${batchEventSnippet(task.host || '', 'start', task.uuid)}

echo ==========================================================
echo [!date! !time!]  START  ${task.uuid}
echo  Source      : !SOURCE!
echo  Target      : !DST_PATH!
echo  NetworkPath : !NETWORK_PATH!
echo ----------------------------------------------------------

:: --- validate the source ---------------------------------------------------
:: A scheduled task runs in its own logon session: mapped drive letters from the
:: interactive session do not exist there, so only local folders can be a source.
if "!SOURCE:~0,2!"=="\\\\" (
  echo [ERROR] Network locations are not supported as a backup source: !SOURCE! >> "%LOG%" 2>&1
  echo [ERROR] Choose a folder on a local drive of this PC instead. >> "%LOG%" 2>&1
  set "RC=16"
  goto :_finish
)

if not exist "!SOURCE!" (
  echo [ERROR] Source folder not found: !SOURCE! >> "%LOG%" 2>&1
  echo [ERROR] Mapped network drives are not supported - a scheduled backup cannot see them. Choose a folder on a local drive of this PC instead. >> "%LOG%" 2>&1
  set "RC=16"
  goto :_finish
)

:: --- mount SMB and extract drive letter via the helper ---------------------
echo [DEBUG] mount command: cmd /c ""%MOUNTBAT%" "!SMB_HOST!" "!SMB_SHARE!" "!CRED_FILE!"" >> "%LOG%" 2>&1

:: Scratch file is named after the task. %RANDOM% is time-seeded, so tasks started
:: in the same second collided, and the old extract file had no unique part at all.
set "TEMP_JSON=%TEMP%\\houston_mount_${task.uuid}.txt"
cmd /c ""%MOUNTBAT%" "!SMB_HOST!" "!SMB_SHARE!" "!CRED_FILE!"" > "!TEMP_JSON!" 2>&1

echo [DEBUG] mount output: >> "%LOG%"
type "!TEMP_JSON!" >> "%LOG%" 2>&1

:: Do not name this "temp": that shadows %TEMP%, and when the parse below found
:: nothing the inherited C:\...\Temp value yielded drive "C" and the copy went local.
set "RAWDL="
for /f "tokens=2 delims=:" %%a in ('findstr /i "DriveLetter" "!TEMP_JSON!" 2^>nul') do set "RAWDL=%%a"
del "!TEMP_JSON!" >nul 2>&1
set "RAWDL=!RAWDL:"=!"
set "RAWDL=!RAWDL: =!"
set "drive=!RAWDL:~0,1!"

if not defined drive (
  echo [ERROR] Could not determine drive letter - SMB mount failed >> "%LOG%" 2>&1
  set "RC=8"
  goto :_finish
)

if /i "!drive!"=="%SystemDrive:~0,1%" (
  echo [ERROR] Mount resolved to the system drive - refusing to back up locally >> "%LOG%" 2>&1
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
:: /XJ: user profile folders contain deny-ACL junctions (My Music, My Pictures,
:: My Videos) kept only for XP compatibility; following them returns error 5.
robocopy "!SOURCE!" "!DEST!" /E /Z /FFT /XJ /R:2 /W:5 /MT:8 /V /NJH /bytes
set "RC=!errorlevel!"

:_finish
:: --- backup_end (with install_id + smb_user) -------------------------------
for /f "delims=" %%I in ('powershell -NoProfile -Command "Get-Date -Format o"') do set "TS2=%%I"
set "STATUS="
if !RC! GEQ 8 (set STATUS=failure) else (set STATUS=success)
>> "%EVENT_LOG%" echo {^"event^":^"backup_end^",^"timestamp^":^"!TS2!^",^"uuid^":^"${task.uuid}"^,^"host^":^"${task.host}"^,^"share^":^"${task.share}"^,^"source^":^"${task.source}"^,^"target^":^"${rawDst}"^,^"status^":^"!STATUS!"^,^"install_id^":^"!INSTALL_ID!"^,^"smb_user^":^"!SMB_USER!"^}

set "BACKUP_STATUS=!STATUS!"
if !RC! GEQ 8 (set "BACKUP_ERROR=robocopy exit code !RC!") else (set "BACKUP_ERROR=")
${batchEventSnippet(task.host || '', 'end', task.uuid)}

:: --- clean up mapping + exit code interpretation ---------------------------
timeout /t 2 >nul
if defined drive net use !drive!: /delete /y >> "%LOG%" 2>&1

if !RC! GEQ 8 (
  echo [ERROR] robocopy returned !RC! >> "%LOG%" 2>&1
  set "ENDMSG=Backup failed rc=!RC!"
) else (
  echo [INFO] robocopy completed with code !RC! >> "%LOG%" 2>&1
  set "ENDMSG=Backup completed rc=!RC!"
)
>> "%LOG%" echo ===== [!TS2!] !ENDMSG! =====
if !RC! GEQ 8 exit /b !RC!
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

# 3) Remove the credential file only if no other BAT references the same cred path.
#    A scan that fails counts as in-use — never delete on incomplete evidence.
$credPath = "${credEsc}"
$credInUse = $true
try {
  $otherBats = @(Get-ChildItem -Path "${scriptsDirEsc}" -Filter "Houston_Backup_Task_*.bat" -ErrorAction Stop)
  $credInUse = $false
  foreach ($b in $otherBats) {
    if (Select-String -Path $b.FullName -Pattern $credPath -SimpleMatch -Quiet -ErrorAction Stop) {
      $credInUse = $true
      break
    }
  }
} catch {
  $credInUse = $true
}

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

# 3) For each cred file, delete only if no remaining BAT references it.
#    If enumeration fails we cannot prove a credential is unused, so keep them all.
$scanOk = $false
$remainingBats = @()
try {
  $remainingBats = @(Get-ChildItem -Path "${scriptsDirEsc}" -Filter "Houston_Backup_Task_*.bat" -ErrorAction Stop)
  $scanOk = $true
} catch {
  $scanOk = $false
}

if ($scanOk) {
  foreach ($credPath in $CredPaths) {
    $inUse = $false
    foreach ($b in $remainingBats) {
      try {
        if (Select-String -Path $b.FullName -Pattern $credPath -SimpleMatch -Quiet -ErrorAction Stop) {
          $inUse = $true
          break
        }
      } catch {
        $inUse = $true
        break
      }
    }

    if (-not $inUse) {
      Remove-Item -Path $credPath -Force -ErrorAction SilentlyContinue
    }
  }
}
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
        /* The trigger returned by -Once has no populated Repetition object, so assigning
         * into it throws PropertyNotFound. Repetition must come from the parameters, and
         * an omitted duration means "indefinitely" — a large finite one is out of range. */
        return `
$startTime   = "${startDate}"
$taskTrigger = New-ScheduledTaskTrigger -Once -At $startTime -RepetitionInterval (New-TimeSpan -Hours 1)
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
          const pick = (re: RegExp) => cimProperties.match(re)?.[1];
          startBoundaryMatch = pick(/StartBoundary\s*=\s*"([^"]+)"/);
          hoursIntervalMatch = pick(/HoursInterval\s*=\s*(\d+)/);
          daysIntervalMatch = pick(/DaysInterval\s*=\s*(\d+)/);
          weeksIntervalMatch = pick(/WeeksInterval\s*=\s*(\d+)/);
          monthsIntervalMatch = pick(/MonthsInterval\s*=\s*(\d+)/);
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
              startDate: new Date(startBoundaryMatch),
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
