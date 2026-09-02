import { jsonLogger } from '../main'; 
import { BackUpManager, BackupProgressCallback } from "./types";
import { BackUpTask, backupTaskTag, TaskSchedule } from "@45drives/houston-common-lib";
import * as fs from "fs";
import * as os from "os";
import { exec, execSync, execFileSync, spawn } from "child_process";
import { getOS, getAppPath, getSmbTargetFromSmbTarget, reconstructFullTarget } from "../utils";
import { assertSafeHost, assertSafeShare, assertSafeUsername, sanitizeCronComment, shellQuote, toBase64 } from "../security";
import { checkBackupTaskStatus } from './CheckSmbStatus';
import path, { join } from "path";
import { app } from 'electron';
import { getCredentialManager } from '../credentialManager';
import { syncBackupConfig, getClientId, bashEventSnippet } from './broadcasterApi';

const SCRIPT_DIR = path.join(os.homedir(), ".local", "share", "houston-backups");

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
        const smbUserMatch = content.match(/SMB_USER='([^']+)'/);
        const startDateMatch = content.match(/START_DATE='([^']+)'/);
        const startDate = startDateMatch ? new Date(startDateMatch[1]) : new Date();
        const descMatch = content.match(/^DESC='([^']*)'/m);
        const nameMatch = content.match(/^BACKUP_NAME='([^']*)'/m);
        const disabledMatch = content.match(/^DISABLED='([^']*)'/m);
        if (!uuidMatch || !sourceMatch || !targetMatch || !smbHostMatch || !smbShareMatch || !smbUserMatch) continue;

        const cronLines = execSync("crontab -l 2>/dev/null || true").toString().split("\n");
        const matchingLine = cronLines.find(line => line.includes(uuidMatch[1]));
        const parsedSchedule = matchingLine ? this.parseCronSchedule(matchingLine) : null;

        const task: BackUpTask = {
          uuid: uuidMatch[1],
          source: sourceMatch[1].replace(/\/+$/, ""),
          target: targetMatch[1],
          host: smbHostMatch[1],
          share: smbShareMatch[1],
          description: descMatch ? descMatch[1] : "Unnamed",
          name: nameMatch ? nameMatch[1] : undefined,
          disabled: disabledMatch ? disabledMatch[1] === 'true' : false,
          schedule: parsedSchedule ?? { repeatFrequency: "day", startDate },
          status: "checking",
          smb_user: smbUserMatch[1],
        };

        tasks.push(task);
      } catch (err) {
        console.warn(`Error processing backup task file: ${filename}`, err);
      }
    }

    return tasks;
  }

  isFirstBackupNeeded(
    smbHost: string,
    smbShare: string,
    smbUser?: string
  ): boolean {
    const fstabPath = "/etc/fstab";
    const mountBase = "/mnt/houston-mounts";
    const credBase = "/etc/samba/houston-credentials";

    try {
      // If we don't know which SMB user this is for, require a first run
      // so we can capture per-user credentials & create the keyed entries.
      if (!smbUser || !smbUser.trim()) return true;

      const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "_");
      const key = `${safe(smbHost)}_${safe(smbShare)}_${safe(smbUser)}`;

      const mountDir = `${mountBase}/${key}`;
      const credFile = `${credBase}/${key}.cred`;

      // 1) base mount root present?
      if (!fs.existsSync(mountBase)) return true;

      // 2) per-user cred file present?
      if (!fs.existsSync(credFile)) return true;

      // 3) fstab has a matching line for this host/share + mountDir + credFile?
      const fstab = fs.readFileSync(fstabPath, "utf-8");
      const hasLine =
        fstab.includes(`//${smbHost}/${smbShare}`) &&
        fstab.includes(mountDir) &&
        fstab.includes(`credentials=${credFile}`);

      // If the exact keyed line is missing → we still need the first run
      return !hasLine;
    } catch (err) {
      console.warn("isFirstBackupNeeded():", err);
      return true; // be cautious if anything goes wrong
    }
  }


  schedule(task: BackUpTask, username: string, password: string): Promise<{ stdout: string, stderr: string }> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(SCRIPT_DIR)) fs.mkdirSync(SCRIPT_DIR, { recursive: true });
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

      const scriptPath = path.join(SCRIPT_DIR, `Houston_Backup_Task_${task.uuid}.sh`);

      const [smbHost, smbSharePart] = task.target.split(":");
      const smbShare = smbSharePart.split("/")[0];

      // store() also creates the server record, so the SMB creds never touch login creds
      getCredentialManager().store(smbHost, smbShare, username, password);
      this.ensureFstabEntry(smbHost, smbShare, username, password);

      this.generateBackupScript(task, username, password, scriptPath);

      const cronLine = `${this.scheduleToCron(task.schedule)} bash \"${scriptPath}\"`;
      const existingCrontab = execSync("crontab -l 2>/dev/null || true").toString()
        .split("\n")
        .filter(line => !line.includes(task.uuid));
      existingCrontab.push(cronLine);

      execSync("crontab -", { input: existingCrontab.join("\n") + "\n" });

      // Sync backup config to broadcaster API (best-effort, non-blocking)
      const serverHost = task.host || smbHost;
      syncBackupConfig(serverHost, username, password, task, getClientId()).catch(() => {});

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

      // store() also creates the server record, so the SMB creds never touch login creds
      getCredentialManager().store(smbHost, smbShare, username, password);

      this.ensureFstabEntry(smbHost, smbShare, username, password);

      this.generateBackupScript(task, username, password, scriptPath);
      const cronLine = `${this.scheduleToCron(task.schedule)} bash "${scriptPath}" # ${sanitizeCronComment(task.description)}`;
      cronEntries.push(cronLine);
      onProgress?.(i + 1, total, `Created and scheduled ${task.description}`);
    }

    const existing = execSync("crontab -l 2>/dev/null || true").toString().split("\n")
      .filter(line => !tasks.some(task => line.includes(`Houston_Backup_Task_${task.uuid}.sh`)));

    const finalCrontab = [...existing, ...cronEntries].join("\n") + "\n";
    execSync("crontab -", { input: finalCrontab });

    // Sync all backup configs to broadcaster API (best-effort, non-blocking)
    const clientId = getClientId();
    for (const task of tasks) {
      const serverHost = task.host || task.target.split(":")[0];
      syncBackupConfig(serverHost, username, password, task, clientId).catch(() => {});
    }

    // onProgress?.(total, total, "All backup tasks scheduled successfully.");
  }

  applyCleanedCrontab(lines: string[]) {
    const cleaned = lines.map(line => line.trim()).filter(line => line.length > 0);
    const finalContent = cleaned.join("\n");

    if (finalContent.trim().length === 0) {
      try { execSync("crontab -r", { stdio: "ignore" }); } catch { /* noop */ }
    } else {
      execSync("crontab -", { input: finalContent + "\n" });
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
  
  
  async updateSchedule(task: BackUpTask, username: string, password: string): Promise<void> {
    const crontabLines = execSync("crontab -l 2>/dev/null || true").toString().split("\n");
    const updated = [...crontabLines]; // Copy

    const index = updated.findIndex(line => line.includes(`Houston_Backup_Task_${task.uuid}.sh`));
    if (index === -1) throw new Error(`Could not find matching cron entry for UUID ${task.uuid}`);

    const scriptPath = path.join(os.homedir(), ".local", "share", "houston-backups", `Houston_Backup_Task_${task.uuid}.sh`);
    if (!fs.existsSync(scriptPath)) throw new Error(`Script not found at expected path: ${scriptPath}`);

    // Regenerate the backup script with updated task fields (name, source, etc.)
    // Resolve credentials: use provided ones, or fall back to existing script values
    let resolvedUser = username;
    let resolvedPass = password;
    if (!resolvedUser || !resolvedPass) {
      const content = fs.readFileSync(scriptPath, "utf-8");
      const smbUserMatch = content.match(/SMB_USER='([^']+)'/);
      if (smbUserMatch && !resolvedUser) resolvedUser = smbUserMatch[1];
      if (!resolvedPass) {
        // Try credential vault — use task.host/share if available, else parse target
        let vaultHost: string;
        let vaultShare: string;
        if (task.host && task.share) {
          vaultHost = task.host;
          vaultShare = task.share;
        } else {
          const [smbHostRaw, smbSharePart] = task.target.split(":");
          vaultHost = smbHostRaw;
          vaultShare = smbSharePart?.split("/")[0] || '';
        }
        const stored = getCredentialManager().retrieve(vaultHost, vaultShare, resolvedUser);
        if (stored) resolvedPass = stored.password;
      }
    }
    this.generateBackupScript(task, resolvedUser, resolvedPass, scriptPath);

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
    execSync("crontab -", { input: updated.join("\n") + "\n" });
  }
  

  runNow(task: BackUpTask, onProgress?: BackupProgressCallback): Promise<{ stdout: string; stderr: string }> {
    const scriptPath = path.join(SCRIPT_DIR, `Houston_Backup_Task_${task.uuid}.sh`);

    // Patch existing script to ensure progress flags are present
    this.ensureProgressFlags(scriptPath);

    return new Promise((resolve, reject) => {
      const child = spawn('bash', [scriptPath], {
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        if (onProgress) {
          // Parse phase markers from script echo lines
          if (chunk.includes('[INFO] Running rsync')) {
            onProgress(null, 'Running rsync...');
          } else if (chunk.includes('mount')) {
            onProgress(null, 'Mounting share...');
          }
          // rsync --info=progress2 outputs: 1,234,567  42%  10.50MB/s  0:01:23\r
          // Grab the LAST percentage in the chunk (multiple may arrive batched)
          const matches = [...chunk.matchAll(/(\d+)%/g)];
          if (matches.length > 0) {
            onProgress(parseInt(matches[matches.length - 1][1], 10), 'Transferring files...');
          }
        }
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

  /** Patch an existing on-disk script to add progress flags if missing */
  protected ensureProgressFlags(scriptPath: string): void {
    try {
      let script = fs.readFileSync(scriptPath, 'utf8');
      let changed = false;

      // Add --info=progress2 --no-inc-recursive to rsync if missing
      if (script.includes('rsync ') && !script.includes('--info=progress2')) {
        script = script.replace(/rsync -a\b/, 'rsync -a --info=progress2 --no-inc-recursive');
        changed = true;
      }

      // Upgrade tee to unbuffered if not already
      if (script.includes('>(tee -a') && !script.includes('stdbuf')) {
        script = script.replace(/>\(tee -a/, '>(stdbuf -o0 tee -a');
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(scriptPath, script, { mode: 0o700 });
      }
    } catch { /* script doesn't exist yet or can't be read */ }
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
    const safeHost = assertSafeHost(smbHost);
    const safeShare = assertSafeShare(smbShare);
    const safeUser = assertSafeUsername(username);

    const credDir = "/etc/samba/houston-credentials";
    const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "_");
    const key = `${safe(smbHost)}_${safe(smbShare)}_${safe(username)}`;

    const credFile = `${credDir}/${key}.cred`;
    const mountDir = `/mnt/houston-mounts/${key}`;
    const localUser = os.userInfo().username;

    const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
    const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;

    const fstabEntry =
      `//${safeHost}/${safeShare} ${mountDir} cifs ` +
      `credentials=${credFile},iocharset=utf8,rw,uid=${uid},gid=${gid},vers=3.0,user,noauto 0 0`;

    const fstab = fs.readFileSync("/etc/fstab", "utf-8");
    const hasFstab = fstab.includes(mountDir);
    const hasCred = fs.existsSync(credFile);
    const hasMountDir = fs.existsSync(mountDir);
    if (!hasFstab || !hasCred || !hasMountDir) {
      const passwordB64 = toBase64(password);
      const scriptContent = `#!/bin/bash
set -euo pipefail
mkdir -p ${shellQuote(credDir)}
chmod 711 ${shellQuote(credDir)}
PASSWORD="$(printf '%s' ${shellQuote(passwordB64)} | base64 --decode)"
printf 'username=%s\n' ${shellQuote(safeUser)} > ${shellQuote(credFile)}
printf 'password=%s\n' "$PASSWORD" >> ${shellQuote(credFile)}
chown ${localUser}:${localUser} ${shellQuote(credFile)}
chmod 600 ${shellQuote(credFile)}
mkdir -p ${shellQuote(mountDir)}
chown ${localUser}:${localUser} ${shellQuote(mountDir)}
chmod 755 ${shellQuote(mountDir)}
${ hasFstab ? '' : `echo ${shellQuote(fstabEntry)} >> /etc/fstab` }
`;

      const tempScript = path.join(os.tmpdir(), `houston_fstab_${key}.sh`);
      fs.writeFileSync(tempScript, scriptContent, { mode: 0o700 });
      execFileSync(this.pkexec, ["bash", tempScript]);
      try { fs.unlinkSync(tempScript); } catch { }
    }
  }


  protected generateBackupScript(task: BackUpTask, username: string, password: string, scriptPath: string): void {
    // Use task.host/task.share if available; fall back to parsing target for legacy tasks
    let smbHost: string;
    let smbShare: string;
    if (task.host && task.share) {
      smbHost = assertSafeHost(task.host);
      smbShare = assertSafeShare(task.share);
    } else {
      const [smbHostRaw, smbSharePart] = task.target.split(":");
      smbHost = assertSafeHost(smbHostRaw);
      smbShare = assertSafeShare(smbSharePart.split("/")[0]);
    }

    const logPath = path.join(LOG_DIR, `Houston_Backup_Task_${task.uuid}.log`);
    const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "_");
    const key = `${safe(smbHost)}_${safe(smbShare)}_${safe(username)}`;
    const mountDir = `/mnt/houston-mounts/${key}`;

    // If target already lacks host:share prefix, use it as-is; otherwise strip prefix
    const target = task.target.includes(':') ? getSmbTargetFromSmbTarget(task.target) : task.target;

    const scriptContent = `#!/bin/bash
set -euo pipefail

EVENT_LOG=${shellQuote(path.join(LOG_DIR, "45drives_backup_events.json"))}
SMB_HOST=${shellQuote(smbHost)}
SMB_SHARE=${shellQuote(smbShare)}
SMB_USER=${shellQuote(username)}
SOURCE=${shellQuote(`${task.source}/`)}
TARGET=${shellQuote(target)}
LOG_FILE=${shellQuote(logPath)}
MOUNT_DIR=${shellQuote(mountDir)}
CRED_FILE=${shellQuote(`/etc/samba/houston-credentials/${key}.cred`)}
START_DATE=${shellQuote(String(task.schedule.startDate))}
DESC=${shellQuote(task.description)}
BACKUP_NAME=${shellQuote(task.name || '')}
DISABLED='${task.disabled ? 'true' : 'false'}'
CLIENT_ID_FILE=${shellQuote(path.join(app.getPath("userData"), "client-id.txt"))}
INSTALL_ID="$(cat "$CLIENT_ID_FILE" 2>/dev/null || true)"

# Skip execution if task is disabled
if [ "$DISABLED" = "true" ]; then
  echo "[INFO] Task is disabled, skipping."
  exit 0
fi

mkdir -p "$(dirname "$LOG_FILE")"

# Send ALL stdout/stderr to both console and the log file (unbuffered for real-time progress)
exec > >(stdbuf -o0 tee -a "$LOG_FILE") 2>&1

echo '{"event":"backup_start","timestamp":"'$(date -Iseconds)'","uuid":"'"${task.uuid}"'","host":"'"$SMB_HOST"'","share":"'"$SMB_SHARE"'","source":"'"$SOURCE"'","target":"'"$TARGET"'","install_id":"'"$INSTALL_ID"'","smb_user":"'"$SMB_USER"'"}' >> "$EVENT_LOG"

# Report start event to broadcaster API (best-effort)
${bashEventSnippet(smbHost, 'start', task.uuid)}

BACKUP_ENDED=false
write_backup_end() {
  local end_status="\${1:-failure}"
  if [ "$BACKUP_ENDED" = "false" ]; then
    BACKUP_ENDED=true
    echo '{"event":"backup_end","timestamp":"'"$(date -Iseconds)"'","uuid":"'"${task.uuid}"'","host":"'"$SMB_HOST"'","share":"'"$SMB_SHARE"'","source":"'"$SOURCE"'","target":"'"$TARGET"'","status":"'"$end_status"'","install_id":"'"$INSTALL_ID"'","smb_user":"'"$SMB_USER"'"}' >> "$EVENT_LOG"
  fi
}

cleanup() {
  # Write backup_end if it wasn't written (script crashed/errored early)
  write_backup_end "failure"
  # Only attempt unmount if it's actually mounted
  if mountpoint -q "$MOUNT_DIR"; then
    echo "[CLEANUP] Unmounting $MOUNT_DIR"
    umount "$MOUNT_DIR" || true
  fi
}
trap cleanup EXIT

echo "===== [$(date -Iseconds)] Starting backup task: '$DESC' ====="
echo "[INFO] Source: $SOURCE"
echo "[INFO] Target: $TARGET"
echo "[INFO] Mount directory: $MOUNT_DIR"

mkdir -p "$MOUNT_DIR"

# Mount if not already mounted (fstab entry must exist for $MOUNT_DIR)
if mountpoint -q "$MOUNT_DIR"; then
  echo "[INFO] Already mounted at $MOUNT_DIR"
else
  # Try fstab mount first, fall back to direct credentials mount
  if mount "$MOUNT_DIR" 2>/dev/null; then
    echo "[INFO] Mounted via fstab entry"
  elif [ -f "$CRED_FILE" ]; then
    echo "[WARN] fstab mount failed, trying direct mount with credentials..."
    mount -t cifs "//$SMB_HOST/$SMB_SHARE" "$MOUNT_DIR" -o "credentials=$CRED_FILE,iocharset=utf8,rw,vers=3.0"
  else
    echo "[ERROR] No fstab entry and no credential file found at $CRED_FILE"
    echo "[ERROR] Please re-run the backup setup to configure the server connection."
    exit 1
  fi
fi

# Verify mount succeeded
mountpoint -q "$MOUNT_DIR"

echo "[SUCCESS] SMB share mounted at $MOUNT_DIR"

UUID="$(printf '%s' "$TARGET" | awk -F/ '{print $2}')"

MARKER_DIR="$MOUNT_DIR/$UUID/.houston"
MARKER_FILE="$MARKER_DIR/client.json"
mkdir -p "$MARKER_DIR"

printf '{"install_id":"%s","smb_user":"%s","source":"%s","user":"%s","host":"%s","platform":"linux"}\n' \\
"$INSTALL_ID" "$SMB_USER" "$SOURCE" "$(id -un)" "$(hostname -s)" > "$MARKER_FILE"

mkdir -p "$MOUNT_DIR/$TARGET"
echo "[INFO] Running rsync..."
# 'rsync ... || true' is an AND-OR list, not a pipeline, so PIPESTATUS reported the status
# of 'true' and every failure read as success. Capture the real status directly.
set +e
rsync -az --compress-level=1 --info=progress2 --no-inc-recursive "$SOURCE" "$MOUNT_DIR/$TARGET"
RSYNC_STATUS=$?
set -e

case "$RSYNC_STATUS" in
  0)
    echo "[SUCCESS] rsync completed successfully"
    _BCAST_STATUS="success"
    _BCAST_ERROR=""
    EXIT_CODE=0
    ;;
  23|24)
    # 23: some files could not be transferred. 24: files vanished during transfer.
    echo "[WARN] Some files were skipped or vanished during transfer (rsync exit $RSYNC_STATUS)"
    echo "[SUCCESS] rsync completed with warnings (exit $RSYNC_STATUS)"
    # Reported as success: the transfer ran, some files were simply not copyable.
    _BCAST_STATUS="success"
    _BCAST_ERROR="rsync exit code $RSYNC_STATUS"
    EXIT_CODE=0
    ;;
  *)
    echo "[ERROR] rsync failed with exit code $RSYNC_STATUS"
    _BCAST_STATUS="failure"
    _BCAST_ERROR="rsync exit code $RSYNC_STATUS"
    EXIT_CODE=$RSYNC_STATUS
    ;;
esac

write_backup_end "$_BCAST_STATUS"

# Report end event to broadcaster API (best-effort)
${bashEventSnippet(smbHost, 'end', task.uuid)}

echo "===== [$(date -Iseconds)] Backup task completed ====="

# Exit with the classified result so cron sees what actually happened
exit $EXIT_CODE
`;

    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o700 });
  }  


  protected generateCronLine(task: BackUpTask, scriptPath: string): string {
    const cronTiming = this.scheduleToCron(task.schedule);
    const isoStart = task.schedule.startDate.toISOString();
    const comment = `# ${backupTaskTag} start=${isoStart} ${sanitizeCronComment(task.description)}`;
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

    // Cron carries minute precision at best, so anything finer would just be
    // live `Date.now()` bleeding in and making every read look like a change.
    const baseDate = () => {
      const d = isoStartDate ? new Date(isoStartDate) : new Date();
      d.setSeconds(0, 0);
      return d;
    };

    if ((match = hourRe.exec(cron))) {
      const [minutes] = match.slice(1).map(Number);
      const startDate = baseDate();
      startDate.setMinutes(minutes);
      return { repeatFrequency: "hour", startDate };
    } else if ((match = dayRe.exec(cron))) {
      const [minutes, hours] = match.slice(1).map(Number);
      const startDate = baseDate();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      return { repeatFrequency: "day", startDate };
    } else if ((match = weekRe.exec(cron))) {
      const [minutes, hours, weekDay] = match.slice(1).map(Number);
      const startDate = baseDate();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      const currentWeekDay = startDate.getDay();
      startDate.setDate(startDate.getDate() + (weekDay - currentWeekDay));
      return { repeatFrequency: "week", startDate };
    } else if ((match = monthRe.exec(cron))) {
      const [minutes, hours, dayOfMonth] = match.slice(1).map(Number);
      const startDate = baseDate();
      startDate.setMinutes(minutes);
      startDate.setHours(hours);
      startDate.setDate(dayOfMonth);
      return { repeatFrequency: "month", startDate };
    }

    return null;
  }
  
}
