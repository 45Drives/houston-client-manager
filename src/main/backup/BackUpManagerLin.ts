// import log from 'electron-log';
// log.transports.console.level = false;
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
// console.debug = (...args) => log.info(...args);
// console.error = (...args) => log.error(...args);
// console.warn = (...args) => log.warn(...args);
// console.debug = (...args) => log.debug(...args);

// process.on('uncaughtException', (error) => {
//   log.error('Uncaught Exception:', error);
// });

// process.on('unhandledRejection', (reason, promise) => {
//   log.error('Unhandled Rejection at:', promise, 'reason:', reason);
// });
import { jsonLogger } from '../main'; 
import { BackUpManager } from "./types";
import { BackUpTask, backupTaskTag, TaskSchedule } from "@45drives/houston-common-lib";
import * as fs from "fs";
import * as os from "os";
import { exec, execSync, spawn } from "child_process";
import { getOS, getAppPath, getSmbTargetFromSmbTarget, reconstructFullTarget } from "../utils";
import { checkBackupTaskStatus } from './CheckSmbStatus';
import path, { join } from "path";
import { app } from 'electron';

const SCRIPT_DIR = path.join(os.homedir(), ".local", "share", "houston-backups");
// const LOG_DIR = path.join(os.homedir(), ".local", "share", "houston-logs");
const LOG_DIR = path.join(app.getPath('userData'), 'logs');

export class BackUpManagerLin implements BackUpManager {
  protected pkexec: string = "pkexec";

  async queryTasks(): Promise<BackUpTask[]> {
    if (!fs.existsSync(SCRIPT_DIR)) return [];

    const scriptFiles = fs.readdirSync(SCRIPT_DIR).filter(f =>
      f.startsWith("Houston_Backup_Task_") && f.endsWith(".sh")
    );

    const tasks: BackUpTask[] = [];

    for (const filename of scriptFiles) {
      try {
        const scriptPath = path.join(SCRIPT_DIR, filename);
        const content = fs.readFileSync(scriptPath, "utf-8");

        const uuidMatch = filename.match(/Houston_Backup_Task_([a-f0-9\-]+)\.sh/);
        const sourceMatch = content.match(/SOURCE='([^']+)'/);
        const targetMatch = content.match(/TARGET='([^']+)'/);
        const smbHostMatch = content.match(/SMB_HOST='([^']+)'/);
        const smbShareMatch = content.match(/SMB_SHARE='([^']+)'/);
        const startDateMatch = content.match(/START_DATE='([^']+)'/);
        const startDate = startDateMatch ? new Date(startDateMatch[1]) : new Date();
        const descMatch = content.match(/Starting backup task: '([^']+)'/);
        const mirror = content.includes("--delete");

        if (!uuidMatch || !sourceMatch || !targetMatch || !smbHostMatch || !smbShareMatch) continue;

        const cronLines = execSync("crontab -l 2>/dev/null || true").toString().split("\n");
        const matchingLine = cronLines.find(line => line.includes(uuidMatch[1]));
        const parsedSchedule = matchingLine ? this.parseCronSchedule(matchingLine) : null;

        const task: BackUpTask = {
          uuid: uuidMatch[1],
          source: sourceMatch[1].replace(/\/+$/, ""),
          target: targetMatch[1],
          host: smbHostMatch[1],
          share: smbShareMatch[1],
          mirror,
          description: descMatch ? descMatch[1] : "Unnamed",
          schedule: parsedSchedule ?? { repeatFrequency: "day", startDate },
          status: "checking"
        };

        // 🔍 Perform status check
        try {
          task.status = await checkBackupTaskStatus(task);
        } catch (err) {
          console.warn(`Failed to check status for task ${task.uuid}:`, err);
          task.status = "offline_connection_error";
        }

        tasks.push(task);
      } catch (err) {
        console.warn(`Error processing backup task file: ${filename}`, err);
      }
    }

    return tasks;
  }
  


  isFirstBackupNeeded(
    smbHost: string,
    smbShare: string
  ): boolean {
    const mountRoot = "/mnt/houston-mounts";
    const credFile = `/etc/samba/houston-credentials/${smbShare}.cred`;
    const fstabPath = "/etc/fstab";

    try {
      /* 1 ─ root mount directory */
      if (!fs.existsSync(mountRoot)) return true;

      /* 2 ─ credentials file for this share */
      if (!fs.existsSync(credFile)) return true;

      /* 3 ─ fstab line containing //host/share and our cred file */
      const fstab = fs.readFileSync(fstabPath, "utf-8");
      const hasLine = fstab.includes(`//${smbHost}/${smbShare}`)
        && fstab.includes(`credentials=${credFile}`);
      return !hasLine;                // if the line is missing → need first run
    } catch (err) {
      console.warn("isFirstBackupNeeded():", err);
      return true;                    // be cautious if something goes wrong
    }
  }


  schedule(task: BackUpTask, username: string, password: string): Promise<{ stdout: string, stderr: string }> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(SCRIPT_DIR)) fs.mkdirSync(SCRIPT_DIR, { recursive: true });
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

      const scriptPath = path.join(SCRIPT_DIR, `Houston_Backup_Task_${task.uuid}.sh`);

      const [smbHost, smbSharePart] = task.target.split(":");
      const smbShare = smbSharePart.split("/")[0];
      this.ensureFstabEntry(smbHost, smbShare, username, password);

      this.generateBackupScript(task, username, password, scriptPath);

      const cronLine = `${this.scheduleToCron(task.schedule)} bash \"${scriptPath}\"`;
      const existingCrontab = execSync("crontab -l 2>/dev/null || true").toString()
        .split("\n")
        .filter(line => !line.includes(task.uuid));
      existingCrontab.push(cronLine);

      execSync(`echo "${existingCrontab.join("\n")}" | crontab -`);
      resolve({ stdout: "Scheduled via user crontab", stderr: "" });
    });
  }

  async scheduleAllTasks(
    tasks: BackUpTask[],
    username: string,
    password: string,
    onProgress?: (step: number, total: number, message: string) => void
  ): Promise<void> {
    const cronEntries: string[] = [];
    const scriptDir = path.join(os.homedir(), ".local", "share", "houston-backups");
    if (!fs.existsSync(scriptDir)) fs.mkdirSync(scriptDir, { recursive: true });

    const total = tasks.length;

    for (let i = 0; i < total; i++) {
      const task = tasks[i];
      const scriptPath = path.join(scriptDir, `Houston_Backup_Task_${task.uuid}.sh`);

      const [smbHost, smbSharePart] = task.target.split(":");
      const smbShare = smbSharePart.split("/")[0];
      this.ensureFstabEntry(smbHost, smbShare, username, password);

      this.generateBackupScript(task, username, password, scriptPath);
      const cronLine = `${this.scheduleToCron(task.schedule)} bash "${scriptPath}" # ${task.description}`;
      cronEntries.push(cronLine);
      onProgress?.(i + 1, total, `Created and scheduled ${task.description}`);
    }

    const existing = execSync("crontab -l 2>/dev/null || true").toString().split("\n")
      .filter(line => !tasks.some(task => line.includes(`Houston_Backup_Task_${task.uuid}.sh`)));

    const finalCrontab = [...existing, ...cronEntries].join("\n") + "\n";
    execSync(`echo "${finalCrontab}" | crontab -`);

    // onProgress?.(total, total, "All backup tasks scheduled successfully.");
  }

  applyCleanedCrontab(lines: string[]) {
    const cleaned = lines.map(line => line.trim()).filter(line => line.length > 0);
    const finalContent = cleaned.join("\n");

    if (finalContent.trim().length === 0) {
      execSync("crontab -r || true");
    } else {
      execSync(`echo "${finalContent}" | crontab -`);
    }
  }

  unschedule(task: BackUpTask): Promise<void> {
    return new Promise((resolve, reject) => {
      const crontabLines = execSync("crontab -l 2>/dev/null || true").toString().split("\n");
      const filtered = crontabLines.filter(line => !line.includes(task.uuid));

      this.applyCleanedCrontab(filtered);

      const scriptPath = path.join(SCRIPT_DIR, `Houston_Backup_Task_${task.uuid}.sh`);
      const logPath = path.join(LOG_DIR, `backup_task_${task.uuid}.log`);

      try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch { }
      try { if (fs.existsSync(logPath)) fs.unlinkSync(logPath); } catch { }
      resolve();
    });
  }
  
  async unscheduleSelectedTasks(tasks: BackUpTask[]): Promise<void> {
    const crontabLines = execSync("crontab -l 2>/dev/null || true").toString().split("\n");
    const filtered = crontabLines.filter(line =>
      !tasks.some(task => line.includes(`Houston_Backup_Task_${task.uuid}.sh`))
    );

    this.applyCleanedCrontab(filtered);

    for (const task of tasks) {
      const scriptPath = path.join(SCRIPT_DIR, `Houston_Backup_Task_${task.uuid}.sh`);
      const logPath = path.join(LOG_DIR, `backup_task_${task.uuid}.log`);
      try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch { }
      try { if (fs.existsSync(logPath)) fs.unlinkSync(logPath); } catch { }
    }
  }
  
  
  async updateSchedule(task: BackUpTask): Promise<void> {
    const crontabLines = execSync("crontab -l 2>/dev/null || true").toString().split("\n");
    const updated = [...crontabLines]; // Copy

    const index = updated.findIndex(line => line.includes(`Houston_Backup_Task_${task.uuid}.sh`));
    if (index === -1) throw new Error(`Could not find matching cron entry for UUID ${task.uuid}`);

    const scriptPath = path.join(os.homedir(), ".local", "share", "houston-backups", `Houston_Backup_Task_${task.uuid}.sh`);
    if (!fs.existsSync(scriptPath)) throw new Error(`Script not found at expected path: ${scriptPath}`);

    const newTiming = (() => {
      const date = new Date(task.schedule.startDate);
      const min = date.getMinutes();
      const hour = date.getHours();
      const dom = date.getDate();
      const dow = date.getDay();
      switch (task.schedule.repeatFrequency) {
        case "hour": return `${min} * * * *`;
        case "day": return `${min} ${hour} * * *`;
        case "week": return `${min} ${hour} * * ${dow}`;
        case "month": return `${min} ${hour} ${dom} * *`;
        default: throw new Error(`Unsupported repeat frequency: ${task.schedule.repeatFrequency}`);
      }
    })();

    const comment = updated[index].includes('#') ? updated[index].substring(updated[index].indexOf('#')) : '';
    updated[index] = `${newTiming} bash "${scriptPath}" ${comment}`;
    execSync(`echo "${updated.join("\n")}" | crontab -`);
  }
  

  runNow(task: BackUpTask): Promise<{ stdout: string; stderr: string }> {
    const scriptPath = path.join(SCRIPT_DIR, `Houston_Backup_Task_${task.uuid}.sh`);

    return new Promise((resolve, reject) => {
      const child = spawn('bash', [scriptPath], {
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const nonFatalExitCodes = [0, 24, 32];

        if (nonFatalExitCodes.includes(code ?? 1)) {
          resolve({ stdout, stderr });
        } else {
          reject({
            message: `Backup task exited with code ${code}`,
            code,
            stdout,
            stderr,
          });
        }
      });

      child.on('error', (err) => {
        reject({
          message: `Failed to spawn backup task process: ${err.message}`,
          stdout,
          stderr,
        });
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

    const scriptName = `Houston_Backup_Task_${task.uuid}.sh`;
    const scriptPath = join(getAppPath(), scriptName);

    this.generateBackupScript(task, smbUser, smb_pass, scriptPath);
    return this.generateCronLine(task, scriptPath);
  }
  

  protected ensureFstabEntry(smbHost: string, smbShare: string, username: string, password: string): void {
    const credDir = "/etc/samba/houston-credentials";
    const credFile = `${credDir}/${smbShare}.cred`;
    const mountDir = `/mnt/houston-mounts/${smbShare}`;
    const localUser = os.userInfo().username;

    const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
    const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;

    const fstabEntry = `//${smbHost}/${smbShare} ${mountDir} cifs credentials=${credFile},iocharset=utf8,rw,uid=${uid},gid=${gid},vers=3.0,user,noauto 0 0`;

    const fstab = fs.readFileSync("/etc/fstab", "utf-8");
    if (!fstab.includes(`//${smbHost}/${smbShare}`)) {
      const tempScript = `/tmp/add_fstab_entry_${smbShare}.sh`;
      const scriptContent = `#!/bin/bash
mkdir -p "${credDir}"
echo "username=${username}" > "${credFile}"
echo "password=${password}" >> "${credFile}"
chown ${localUser}:${localUser} "${credFile}"
chmod 600 "${credFile}"
mkdir -p "${mountDir}"
chown ${localUser}:${localUser} "${mountDir}"
chmod 755 "${mountDir}"
echo "${fstabEntry}" >> /etc/fstab
`;

      fs.writeFileSync(tempScript, scriptContent, { mode: 0o700 });
      execSync(`${this.pkexec} bash "${tempScript}"`);
    }
  }

  protected generateBackupScript(task: BackUpTask, username: string, password: string, scriptPath: string): void {
    const [smbHost, smbSharePart] = task.target.split(":");
    const smbShare = smbSharePart.split("/")[0];

    // Ensure /etc/fstab and cred file are set up once during schedule
    this.ensureFstabEntry(smbHost, smbShare, username, password);

    const logPath = path.join(LOG_DIR, `Houston_Backup_Task_${task.uuid}.log`);
    const mountDir = `/mnt/houston-mounts/${smbShare}`;
    const target = getSmbTargetFromSmbTarget(task.target);

    const scriptContent = `#!/bin/bash
  EVENT_LOG='${LOG_DIR}/45drives_backup_events.json'
  SMB_HOST='${smbHost}'
  SMB_SHARE='${smbShare}'
  SOURCE='${task.source}/'
  TARGET='${target}'
  LOG_FILE='${logPath}'
  MOUNT_DIR='${mountDir}'
  START_DATE='${task.schedule.startDate}'
  
  echo '{"event":"backup_start",
       "timestamp":"'$(date -Iseconds)'",
       "uuid":"'"${task.uuid}"'",
       "source":"'"${task.source}"'",
       "target":"'"${target}"'"}' >> "$EVENT_LOG"
  mkdir -p "$(dirname "$LOG_FILE")"
  
  cleanup() {
    if [ -d "$MOUNT_DIR" ]; then
      echo "[CLEANUP] Unmounting $MOUNT_DIR" >> "$LOG_FILE"
      umount "$MOUNT_DIR" >> "$LOG_FILE" 2>&1
    fi
  }
  trap cleanup EXIT
  
  {
    echo "===== [$(date -Iseconds)] Starting backup task: '${task.description}' ====="
    echo "[INFO] Source: $SOURCE"
    echo "[INFO] Target: $TARGET"
    echo "[INFO] Mount directory: $MOUNT_DIR"
  
    mkdir -p "$MOUNT_DIR"
  
    mount "$MOUNT_DIR" >> "$LOG_FILE" 2>&1
    if ! mountpoint -q "$MOUNT_DIR"; then
      echo "[ERROR] Failed to mount $MOUNT_DIR" >> "$LOG_FILE"
      exit 1
    fi
    echo "[SUCCESS] SMB share mounted at $MOUNT_DIR"
  
    mkdir -p "$MOUNT_DIR/$TARGET"
    echo "[INFO] Running rsync..."
    rsync -a${task.mirror ? ' --delete' : ''} "$SOURCE" "$MOUNT_DIR/$TARGET" >> "$LOG_FILE" 2>&1
    RSYNC_STATUS=$?
  
    if [ $RSYNC_STATUS -ne 0 ]; then
      echo "[ERROR] rsync failed with exit code $RSYNC_STATUS" >> "$LOG_FILE"
      exit $RSYNC_STATUS
    else
      echo "[SUCCESS] rsync completed successfully" >> "$LOG_FILE"
    fi

    STATUS=$([ $RSYNC_STATUS -eq 0 ] && echo "success" || echo "failure")
    echo '{"event":"backup_end",
       "timestamp":"'$(date -Iseconds)'",
       "uuid":"'"${task.uuid}"'",
       "source":"'"${task.source}"'",
       "target":"'"${target}"'"}',
       "status":"'"$STATUS"'", 
       "mirror":'"${task.mirror}"' }' >> "$EVENT_LOG"
    echo "===== [$(date -Iseconds)] Backup task completed ====="
  } 2>&1 | tee -a "$LOG_FILE"
  `;

    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o700 });
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

    const uuidMatch = scriptPath.match(/Houston_Backup_Task_([a-f0-9\-]+)\.sh$/i);
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
  
}
