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
import { formatDateForTask, getMountSmbScript, getSmbTargetFromSmbTarget } from "../utils";
import path from "path";
import fs from 'fs';
import os from 'os';
import { exec } from "child_process";
import { checkBackupTaskStatus } from './CheckSmbStatus';

/**
 * BackUpManager implementation for **Windows** (user‑context Task Scheduler)
 * ----------------------------------------------------------------------
 *  • Tasks registered under the current user with S4U+LeastPrivilege → no
 *    admin prompt on create/run/remove.
 *  • BackUpTask shape matches Linux/macOS (uuid, host, share, status, …).
 */
export class BackUpManagerWin implements BackUpManager {
  private readonly TASK_PREFIX = "HoustonBackUp_";
  protected logDirectory = path.join(
    process.env.ProgramData || "C:\\ProgramData",
    "houston-backups",
    "logs"
  );

  private async storeCredentials(host: string, username: string, password: string): Promise<void> {
    const ps = `cmdkey /add:${host} /user:${username} /pass:${password}`;
    return new Promise((resolve, reject) => {
      exec(`powershell -NoProfile -Command "${ps}"`, (err) => err ? reject(err) : resolve());
    });
  }

  /** Discover ScheduledTasks and build BackUpTask objects */
  async queryTasks(): Promise<BackUpTask[]> {
    const ps = [
      "Get-ScheduledTask",
      `| Where-Object { $_.TaskName -like '${this.TASK_PREFIX}*' }`,
      "| Select-Object TaskName, Triggers, Actions | ConvertTo-Json -Depth 5"
    ].join(' ');
    const { stdout } = await this.runScript(ps);

    let items: any[] = [];
    try {
      const parsed = JSON.parse(stdout);
      items = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }

    const tasks: BackUpTask[] = [];
    for (const item of items) {
      const name: string = item.TaskName;
      const uuid = name.replace(this.TASK_PREFIX, "");
      const arg = item.Actions?.[0]?.Argument as string;
      const details = this.parseBackupCommand(arg);
      if (!details) continue;

      const schedule = this.convertTriggersToTaskSchedule(item.Triggers);
      if (!schedule) continue;

      const [host, rest] = details.target!.split(':');
      const share = rest.split('/')[0] || '';

      const task: BackUpTask = {
        uuid,
        description: details.description!,
        source: details.source!,
        target: details.target!,
        host,
        share,
        mirror: details.mirror!,
        schedule,
        status: 'checking'
      };
      // async status probe
      try {
        task.status = await checkBackupTaskStatus(task);
      } catch (err) {
        console.warn(`Status probe failed for ${uuid}:`, err);
        task.status = 'offline_connection_error';
      }
      tasks.push(task);
    }
    return tasks;
  }

  /** Schedule a task with a batch file that logs to disk */
  async schedule(
    task: BackUpTask, username: string, password: string
  ): Promise<{ stdout: string; stderr: string }> {
    // ensure log dir
    fs.mkdirSync(this.logDirectory, { recursive: true });
    const [host, sharePart] = task.target.split(':');
    const share = sharePart.split('/')[0];

    await this.storeCredentials(host, username, password);
    const logPath = path.join(this.logDirectory, `backup_task_${task.uuid}.log`);

    // create batch script
    const batName = `run_backup_task_${task.uuid}.bat`;
    const batPath = path.join(os.tmpdir(), batName);
    const mountScript = getMountSmbScript();

    const dest = getSmbTargetFromSmbTarget(task.target).replace(/\//g, "\\");
    const iso = task.schedule.startDate.toISOString();

    const lines: string[] = [];
    lines.push('@echo off');
    lines.push(`set LOG_FILE=${logPath}`);
    lines.push(`powershell -Command "Write-Output '===== %DATE% %TIME% Starting ${task.description} =====' | Tee-Object -FilePath '%LOG_FILE%' -Append"`);
    lines.push(`powershell -Command "cmd /c \\"call ${mountScript} ${host} ${share}\\" | Tee-Object -FilePath '%LOG_FILE%' -Append"`);
    lines.push('if errorlevel 1 ( powershell -Command "Write-Output \'ERROR: mount failed\' | Tee-Object -FilePath \'%LOG_FILE%\' -Append" & exit /b 1 )');
    lines.push(`powershell -Command "xcopy '${task.source}' '%DriveLetter%\\${dest}' /E /I /Y | Tee-Object -FilePath '%LOG_FILE%' -Append"`);
    lines.push('if errorlevel 1 ( powershell -Command "Write-Output \'ERROR: xcopy failed\' | Tee-Object -FilePath \'%LOG_FILE%\' -Append" ) else ( powershell -Command "Write-Output \'SUCCESS: backup complete\' | Tee-Object -FilePath \'%LOG_FILE%\' -Append" )');
    lines.push(`powershell -Command "net use %DriveLetter%: /delete /y | Tee-Object -FilePath '%LOG_FILE%' -Append"`);

    fs.writeFileSync(batPath, lines.join("\r\n"), { mode: 0o700 });

    // register in Task Scheduler
    const taskName = this.TASK_PREFIX + task.uuid;
    const trigger = this.scheduleToTrigger(task.schedule);
    const ps = [
      `$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/C "${batPath}"'`,
      `$trigger = ${trigger}`,
      `$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel LeastPrivilege`,
      `Register-ScheduledTask -TaskName '${taskName}' -Action $action -Trigger $trigger -Principal $principal -Description '${task.description}' -Force`
    ].join('; ');

    return this.runScript(ps);
  }

  async scheduleAllTasks(
    tasks: BackUpTask[], username: string, password: string,
    onProgress?: (step: number, total: number, message: string) => void
  ): Promise<void> {
    fs.mkdirSync(this.logDirectory, { recursive: true });

    const total = tasks.length;

    for (let i = 0; i < total; i++) {
      const task = tasks[i];
      await this.schedule(task, username, password);
      onProgress?.(i + 1, total, `Scheduled ${task.description}`);
    }

    onProgress?.(total, total, "All tasks scheduled successfully.");
  }

  async runNow(task: BackUpTask): Promise<{ stdout: string; stderr: string }> {
    const name = this.TASK_PREFIX + task.uuid;
    return this.runScript(`Start-ScheduledTask -TaskName '${name}'`);
  }


  async unschedule(task: BackUpTask): Promise<void> {
    const name = this.TASK_PREFIX + task.uuid;
    await this.runScript(`Unregister-ScheduledTask -TaskName '${name}' -Confirm:$false`);
    const lp = path.join(this.logDirectory, `backup_task_${task.uuid}.log`);
    if (fs.existsSync(lp)) fs.unlinkSync(lp);
  }

  async unscheduleSelectedTasks(tasks: BackUpTask[]): Promise<void> {
    for (const t of tasks) await this.unschedule(t);
  }


  async updateSchedule(task: BackUpTask, username: string, password: string): Promise<void> {
    await this.unschedule(task);
    await this.schedule(task, username, password);
  }


  /* ------------------------------------------------------------------ */
  /*                         PRIVATE UTILITIES                          */
  /* ------------------------------------------------------------------ */

  private runScript(ps: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      exec(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`,
        (err, stdout, stderr) => err ? reject(err) : resolve({ stdout, stderr })
      );
    });
  }

  private scheduleToTrigger(sched: TaskSchedule): string {
    const at = formatDateForTask(sched.startDate);
    switch (sched.repeatFrequency) {
      case "hour": return `New-ScheduledTaskTrigger -Once -At '${at}' -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration ([TimeSpan]::MaxValue)`;
      case "day": return `New-ScheduledTaskTrigger -Daily -At '${at}'`;
      case "week": return `New-ScheduledTaskTrigger -Weekly -At '${at}'`;
      case "month": return `New-ScheduledTaskTrigger -Monthly -At '${at}'`;
      default: return `New-ScheduledTaskTrigger -Once -At '${at}'`;
    }
  }

  private convertTriggersToTaskSchedule(triggers: any[]): TaskSchedule | null {
    if (!Array.isArray(triggers) || triggers.length === 0) return null;
    const t = triggers[0];
    const dt = new Date(t.StartBoundary);
    const freq: TaskSchedule['repeatFrequency'] = t.Repetition?.Interval?.Hours ? 'hour' : 'day';
    return { repeatFrequency: freq, startDate: dt };
  }

  private parseBackupCommand(cmd: string): Partial<BackUpTask> | null {
    try {
      const file = cmd.replace('/C ', '').trim().replace(/^"|"$/g, '');
      const data: any = {};
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = /^::\s*(\w+)=(.*)$/.exec(line);
        if (m) data[m[1]] = m[2];
      }
      return { description: data.description, source: data.source, target: data.target, mirror: data.mirror === 'true' };
    } catch {
      return null;
    }
  }
}
