import { BackUpManager } from "./types";
import { BackUpTask, backupTaskTag, TaskSchedule, IPCRouter } from "@45drives/houston-common-lib";
import * as fs from "fs";
import * as os from "os";
import { writeFileSync, chmodSync } from 'fs';
import { exec, execSync } from "child_process";
import { getOS, getAppPath, getSmbTargetFromSmbTarget, reconstructFullTarget, runPrivilegedAppend, runPrivilegedReplaceFile } from "../utils";
import path, { join } from "path";

export class BackUpManagerLin implements BackUpManager {
  protected cronFilePath: string = "/etc/cron.d/houston-backup-manager";
  protected pkexec: string = "pkexec";

  queryTasks(): Promise<BackUpTask[]> {
    if (!fs.existsSync(this.cronFilePath)) {
      return new Promise((resolve, _rejest) => {
        resolve([])
      });
    }
    const cronFileContents = fs.readFileSync(this.cronFilePath, "utf-8");
    const cronEntries = cronFileContents
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    const tasks = cronEntries.map((cron) => this.cronToBackupTask(cron)).filter(task => task !== null) as BackUpTask[];

    return new Promise((resolve, _rejest) => {
      resolve(tasks)
    });
  }

  schedule(task: BackUpTask, username: string, password: string): Promise<{ stdout: string, stderr: string }> {
    return new Promise((resolve, reject) => {
      const cron = this.backupTaskToCron(task, username, password);
      // this.ensureCronFile();
      // fs.appendFileSync(this.cronFilePath, cron + "\n", "utf-8");
      runPrivilegedAppend(cron, this.cronFilePath, this.pkexec);
      this.reloadCron();
      resolve({ stdout: "", stderr: "" });
    });
  }

  async scheduleAllTasks(
    tasks: BackUpTask[],
    username: string,
    password: string,
    onProgress?: (step: number, total: number, message: string) => void
  ): Promise<void> {
    const tmpDir = fs.mkdtempSync(join(os.tmpdir(), "backup-batch-"));
    const cronEntries: string[] = [];
    const moveCommands: string[] = [];

    let step = 0;
    const total = tasks.length + 2; // +1 for final script, +1 for cron move

    for (const task of tasks) {
      const taskUUID = task.uuid;
      task.uuid = taskUUID;

      const scriptName = `run_backup_task_${taskUUID}.sh`;
      const tempScriptPath = join(tmpDir, scriptName);
      const finalScriptPath = join(getAppPath(), scriptName);

      this.generateBackupScript(task, username, password, tempScriptPath);

      cronEntries.push(this.generateCronLine(task, finalScriptPath));

      moveCommands.push(`mv "${tempScriptPath}" "${finalScriptPath}"`);
      moveCommands.push(`chmod 700 "${finalScriptPath}"`);

      if (onProgress) {
        onProgress(++step, total, `Created task for ${task.description}`);
      }
    }

    // Write cron file
    const cronTmpPath = join(tmpDir, "houston-backup-manager");
    let existingCron = "";

    if (fs.existsSync(this.cronFilePath)) {
      existingCron = fs.readFileSync(this.cronFilePath, "utf-8").trim();
    }

    const combinedCron = [
      existingCron,
      ...cronEntries
    ].filter(Boolean).join("\n") + "\n";

    fs.writeFileSync(cronTmpPath, combinedCron, "utf-8");

    // Write final setup script to be run via pkexec
    const setupScriptPath = join(tmpDir, "setup_all_tasks.sh");
    const setupScript = `
#!/bin/bash

mv "${cronTmpPath}" "${this.cronFilePath}"
chown root:root "${this.cronFilePath}"
chmod 644 "${this.cronFilePath}"

${moveCommands.join("\n")}

systemctl restart ${getOS() === "debian" ? "cron" : "crond"}
`;

    fs.writeFileSync(setupScriptPath, setupScript, { mode: 0o700 });

    try {
      execSync(`${this.pkexec} bash "${setupScriptPath}"`);
      console.log("✅ All tasks scheduled with one privilege prompt.");
    } catch (err) {
      console.error("❌ Failed to schedule tasks in batch mode:", err);
      throw err;
    }

    if (onProgress) {
      onProgress(step + 1, total, "All backup tasks scheduled successfully.");
    }
  }

  unschedule(task: BackUpTask): void {
    if (!fs.existsSync(this.cronFilePath)) return;

    const cronFileContents = fs.readFileSync(this.cronFilePath, "utf-8");
    const cronEntries = cronFileContents.split(/[\r\n]+/);
    let scriptPathToDelete: string | null = null;

    const newCronEntries = cronEntries.filter((line) => {
      const shouldRemove = line.includes(`run_backup_task_${task.uuid}.sh`);
      if (shouldRemove) {
        const parts = line.split(" ");
        const scriptPath = parts.find(p => p.includes(`run_backup_task_${task.uuid}.sh`));
        if (scriptPath) scriptPathToDelete = scriptPath;
      }
      return !shouldRemove;
    });

    const tmpDir = fs.mkdtempSync(join(os.tmpdir(), "backup-unschedule-"));
    const newCronPath = join(tmpDir, "new_cron");
    const unscheduleScript = join(tmpDir, "unschedule.sh");

    fs.writeFileSync(newCronPath, newCronEntries.join("\n") + "\n", "utf-8");

    const shellScript = `#!/bin/bash
  mv "${newCronPath}" "${this.cronFilePath}"
  chown root:root "${this.cronFilePath}"
  chmod 644 "${this.cronFilePath}"
  ${scriptPathToDelete ? `rm -f "${scriptPathToDelete}"` : ""}
  systemctl restart ${getOS() === "debian" ? "cron" : "crond"}
  `;

    fs.writeFileSync(unscheduleScript, shellScript, { mode: 0o700 });

    try {
      execSync(`${this.pkexec} bash "${unscheduleScript}"`);
      console.log("✅ Task unscheduled with root permissions.");
    } catch (err) {
      console.error("❌ Failed to unschedule task:", err);
      throw err;
    }

    const logPath = `/var/log/houston/backup_task_${task.uuid}.log`;
    if (fs.existsSync(logPath)) {
      try {
        fs.unlinkSync(logPath);
        console.log(`🧹 Removed log file: ${logPath}`);
      } catch (err: any) {
        console.error(`❌ Failed to delete log file: ${logPath}`, err.message);
      }
    }

  }
  

  async unscheduleSelectedTasks(tasks: BackUpTask[]): Promise<void> {
    if (!fs.existsSync(this.cronFilePath)) return;

    const cronFileContents = fs.readFileSync(this.cronFilePath, "utf-8");
    const cronEntries = cronFileContents.split(/[\r\n]+/);

    const tmpDir = fs.mkdtempSync(join(os.tmpdir(), "unschedule-batch-"));
    const newCronEntries: string[] = [];
    const scriptPathsToDelete: string[] = [];

    for (const line of cronEntries) {
      if (tasks.some(task => line.includes(`run_backup_task_${task.uuid}.sh`))) {
        const parts = line.split(/\s+/);
        const scriptPath = parts.find(p => p.includes(`run_backup_task_`) && p.endsWith('.sh'));
        if (scriptPath) {
          scriptPathsToDelete.push(scriptPath);
        }
      } else {
        newCronEntries.push(line);
      }
    }

    const newCronPath = join(tmpDir, "new_cron");
    const shellScriptPath = join(tmpDir, "unschedule_tasks.sh");

    fs.writeFileSync(newCronPath, newCronEntries.join("\n") + "\n", "utf-8");

    const deleteCommands = scriptPathsToDelete.map(p => `rm -f "${p}"`).join("\n");
    const shellScript = `#!/bin/bash
  mv "${newCronPath}" "${this.cronFilePath}"
  chown root:root "${this.cronFilePath}"
  chmod 644 "${this.cronFilePath}"
  ${deleteCommands}
  systemctl restart ${getOS() === "debian" ? "cron" : "crond"}
  `;

    fs.writeFileSync(shellScriptPath, shellScript, { mode: 0o700 });

    try {
      execSync(`${this.pkexec} bash "${shellScriptPath}"`);
      console.log("✅ Selected tasks unscheduled successfully.");
    } catch (err) {
      console.error("❌ Failed to unschedule selected tasks:", err);
      throw err;
    }

    for (const task of tasks) {
      const logPath = `/var/log/houston/backup_task_${task.uuid}.log`;
      if (fs.existsSync(logPath)) {
        try {
          fs.unlinkSync(logPath);
          console.log(`🧹 Removed log file: ${logPath}`);
        } catch (err: any) {
          console.error(`❌ Failed to delete log file: ${logPath}`, err.message);
        }
      }
    }
    
  }
  

  async updateSchedule(task: BackUpTask): Promise<void> {
    if (!fs.existsSync(this.cronFilePath)) {
      throw new Error("Cron file not found.");
    }

    const cronLines = fs.readFileSync(this.cronFilePath, 'utf-8').split('\n');
    const lineIndex = cronLines.findIndex(line =>
      line.includes(`run_backup_task_${task.uuid}.sh`)
    );

    if (lineIndex === -1) {
      throw new Error(`Could not find matching cron entry for UUID ${task.uuid}`);
    }

    const originalLine = cronLines[lineIndex];
    const parts = originalLine.trim().split(/\s+/);
    const scriptPath = parts.find(p => p.endsWith('.sh'));

    if (!scriptPath || !fs.existsSync(scriptPath)) {
      throw new Error("Script not found at expected path.");
    }

    const date = new Date(task.schedule.startDate);
    const minute = date.getMinutes();
    const hour = date.getHours();
    const dayOfMonth = date.getDate();
    const dayOfWeek = date.getDay(); // 0 = Sunday

    let cronTiming: string;

    switch (task.schedule.repeatFrequency) {
      case 'hour':
        // Every hour at the specific minute
        cronTiming = `${minute} * * * *`;
        break;
      case 'day':
        // Daily at a specific time
        cronTiming = `${minute} ${hour} * * *`;
        break;
      case 'week':
        // Weekly on the same weekday as startDate
        cronTiming = `${minute} ${hour} * * ${dayOfWeek}`;
        break;
      case 'month':
        // Monthly on the same day of the month
        cronTiming = `${minute} ${hour} ${dayOfMonth} * *`;
        break;
      default:
        throw new Error(`Unsupported repeat frequency: ${task.schedule.repeatFrequency}`);
    }

    const comment = originalLine.includes('#') ? originalLine.substring(originalLine.indexOf('#')) : '';
    const newLine = `${cronTiming} root ${scriptPath} ${comment}`;

    cronLines[lineIndex] = newLine;
    const updatedContent = cronLines.join('\n');

    runPrivilegedReplaceFile(updatedContent, this.cronFilePath, this.pkexec);
  }

  runNow(task: BackUpTask): Promise<{ stdout: string; stderr: string }> {
    const scriptPath = path.join(getAppPath(), `run_backup_task_${task.uuid}.sh`);
    const command = `${this.pkexec} bash "${scriptPath}"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) return reject(error);
        resolve({ stdout: stdout || "", stderr: stderr || "" });
      });
    });
  }

  protected scheduleToCron(sched: TaskSchedule): string {
    switch (sched.repeatFrequency) {
      case "hour":
        return `${sched.startDate.getMinutes()} * * * *`;
      case "day":
        return `${sched.startDate.getMinutes()} ${sched.startDate.getHours()} * * *`;
      case "week":
        return `${sched.startDate.getMinutes()} ${sched.startDate.getHours()} * * ${sched.startDate.getDay()}`;
      case "month":
        return `${sched.startDate.getMinutes()} ${sched.startDate.getHours()} ${sched.startDate.getDate()} * *`;
      default:
        return '';
    }
  }

  protected backupTaskToCron(task: BackUpTask, smbUser: string, smb_pass: string): string {
    if (task.source.includes("'") || task.target.includes("'")) {
      throw new Error("Source/target cannot contain single quotes");
    }

    const scriptName = `run_backup_task_${task.uuid}.sh`;
    const scriptPath = join(getAppPath(), scriptName);

    this.generateBackupScript(task, smbUser, smb_pass, scriptPath);
    return this.generateCronLine(task, scriptPath);
  }
  

  protected generateBackupScript(task: BackUpTask, username: string, password: string, scriptPath: string): void {
    const [smbHost, smbSharePart] = task.target.split(":");
    const smbShare = smbSharePart.split("/")[0];
    const target = getSmbTargetFromSmbTarget(task.target);
    // const mountPoint = `/mnt/backup_${task.uuid}`;
    // const mountPoint = `/mnt/backup_$$`;

  //   const scriptContent = `#!/bin/bash
  // SMB_HOST='${smbHost}'
  // SMB_SHARE='${smbShare}'
  // SMB_USER='${username}'
  // SMB_PASS='${password}'
  // SOURCE='${task.source}/'
  // TARGET='${target}'
  // MOUNT_POINT="/mnt/backup_$$"
  
  // cleanup() {
  //   umount "$MOUNT_POINT" 2>/dev/null
  //   sleep 1
  //   mountpoint -q "$MOUNT_POINT" || rmdir "$MOUNT_POINT"
  // }
  // trap cleanup EXIT

  // LOG_FILE="/var/log/houston/backup_task_${task.uuid}.log"
  // mkdir -p "$(dirname "$LOG_FILE")"
  // {
  //   echo "===== $(date -Iseconds): Starting backup task '${task.description}' ====="

  //   mkdir -p "$MOUNT_POINT"

  //   mount -t cifs "//$SMB_HOST/$SMB_SHARE" "$MOUNT_POINT" \\
  //     -o username="$SMB_USER",password="$SMB_PASS",rw,iocharset=utf8,uid=0,gid=0

  //   if ! mountpoint -q "$MOUNT_POINT"; then
  //     echo "ERROR: Failed to mount //$SMB_HOST/$SMB_SHARE"
  //     exit 1
  //   fi

  //   mkdir -p "$MOUNT_POINT/$TARGET"
  //   rsync -a${task.mirror ? ' --delete' : ''} "$SOURCE" "$MOUNT_POINT/$TARGET"

  //   echo "SUCCESS: Backup completed at $(date -Iseconds)"
  // } >> "$LOG_FILE" 2>&1
  // `;
    const scriptContent = `#!/bin/bash
SMB_HOST='${smbHost}'
SMB_SHARE='${smbShare}'
SMB_USER='${username}'
SMB_PASS='${password}'
SOURCE='${task.source}/'
TARGET='${target}'
MOUNT_POINT="/mnt/backup_$$"

cleanup() {
  echo "[CLEANUP] Unmounting and removing mount point..." >> "$LOG_FILE"
  umount "$MOUNT_POINT" 2>> "$LOG_FILE"
  sleep 1
  if mountpoint -q "$MOUNT_POINT"; then
    echo "[CLEANUP] Failed to unmount $MOUNT_POINT" >> "$LOG_FILE"
  else
    rmdir "$MOUNT_POINT"
    echo "[CLEANUP] Cleanup complete." >> "$LOG_FILE"
  fi
}
trap cleanup EXIT

LOG_FILE="/var/log/houston/backup_task_${task.uuid}.log"
mkdir -p "$(dirname "$LOG_FILE")"

{
  echo "===== [$(date -Iseconds)] Starting backup task: '${task.description}' ====="
  echo "[INFO] Source: $SOURCE"
  echo "[INFO] Target: //$SMB_HOST/$SMB_SHARE/$TARGET"
  echo "[INFO] Creating mount point: $MOUNT_POINT"
  mkdir -p "$MOUNT_POINT"

  echo "[INFO] Attempting to mount SMB share..."
  mount -t cifs "//$SMB_HOST/$SMB_SHARE" "$MOUNT_POINT" \\
    -o username="$SMB_USER",password="$SMB_PASS",rw,iocharset=utf8,vers=3.0,sec=ntlmssp

  if ! mountpoint -q "$MOUNT_POINT"; then
    echo "[ERROR] Failed to mount //$SMB_HOST/$SMB_SHARE at $MOUNT_POINT"
    exit 1
  fi
  echo "[SUCCESS] SMB share mounted at $MOUNT_POINT"

  mkdir -p "$MOUNT_POINT/$TARGET"
  echo "[INFO] Starting rsync..."
  rsync -a${task.mirror ? ' --delete' : ''} "$SOURCE" "$MOUNT_POINT/$TARGET"
  RSYNC_STATUS=$?

  if [ $RSYNC_STATUS -ne 0 ]; then
    echo "[ERROR] rsync failed with exit code $RSYNC_STATUS"
    exit $RSYNC_STATUS
  else
    echo "[SUCCESS] rsync completed successfully"
  fi

  echo "===== [$(date -Iseconds)] Backup task complete ====="
} >> "$LOG_FILE" 2>&1
`;


    writeFileSync(scriptPath, scriptContent, { mode: 0o700 });
    chmodSync(scriptPath, 0o700);
  }

  protected generateCronLine(task: BackUpTask, scriptPath: string): string {
    const cronTiming = this.scheduleToCron(task.schedule);
    const isoStart = task.schedule.startDate.toISOString();
    const comment = `# ${backupTaskTag} start=${isoStart} ${task.description}`;
    return `${cronTiming} root ${scriptPath} ${comment}`;
  }
  
  protected cronToBackupTask(cron: string): BackUpTask | null {
    const schedule = this.parseCronSchedule(cron);
    if (!schedule) return null;

    const commentMatch = cron.match(/#\s*(.*)$/);
    const description = commentMatch ? commentMatch[1].trim() : "Unnamed Backup";

    const parts = cron.split(" ");
    const scriptPath = parts.slice(5).find(p => p.endsWith(".sh"));
    if (!scriptPath || !fs.existsSync(scriptPath)) return null;

    const uuidMatch = scriptPath.match(/run_backup_task_([a-f0-9\-]+)\.sh$/i);
    const uuid = uuidMatch ? uuidMatch[1] : undefined;
    if (!uuid) return null;

    const scriptContent = fs.readFileSync(scriptPath, "utf-8");
    const sourceMatch = scriptContent.match(/SOURCE='([^']+)'/);
    const targetMatch = scriptContent.match(/TARGET='([^']+)'/);
    if (!sourceMatch || !targetMatch) return null;

    return {
      schedule,
      mirror: scriptContent.includes("--delete"),
      source: sourceMatch[1].replace(/\/+$/, ""), // remove trailing slash
      target: reconstructFullTarget(scriptPath),
      description,
      uuid
    };
  }
  
  protected parseCronSchedule(cron: string): TaskSchedule | null {
    const hourRe = /^(\d+) \* \* \* \*/;
    const dayRe = /^(\d+) (\d+) \* \* \*/;
    const weekRe = /^(\d+) (\d+) \* \* (\d+)/;
    const monthRe = /^(\d+) (\d+) (\d+) \* \*/;

    let isoStartDate: Date | null = null;

    const isoMatch = cron.match(/start=([^\s]+)/);
    if (isoMatch && isoMatch[1]) {
      isoStartDate = new Date(isoMatch[1]);
    }

    let match: RegExpExecArray | null;

    if ((match = hourRe.exec(cron))) {
      const [minutes] = match.slice(1).map(Number);
      const startDate = isoStartDate ?? new Date();
      startDate.setMinutes(minutes);
      return { repeatFrequency: "hour", startDate };
    } else if ((match = dayRe.exec(cron))) {
      const [minutes, hours] = match.slice(1).map(Number);
      const startDate = isoStartDate ?? new Date();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      return { repeatFrequency: "day", startDate };
    } else if ((match = weekRe.exec(cron))) {
      const [minutes, hours, weekDay] = match.slice(1).map(Number);
      const startDate = isoStartDate ?? new Date();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      const currentWeekDay = startDate.getDay();
      startDate.setDate(startDate.getDate() + (weekDay - currentWeekDay));
      return { repeatFrequency: "week", startDate };
    } else if ((match = monthRe.exec(cron))) {
      const [minutes, hours, dayOfMonth] = match.slice(1).map(Number);
      const startDate = isoStartDate ?? new Date();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      startDate.setDate(dayOfMonth);
      return { repeatFrequency: "month", startDate };
    }

    return null;
  }
  

  protected reloadCron() {
    const os = getOS();


    let cron = "crond"
    if (os === "debian") {
      cron = "cron"
    }

    execSync(`${this.pkexec} systemctl restart ${cron}`);
  }
}
