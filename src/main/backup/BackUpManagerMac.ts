import { BackUpManager, BackupProgressCallback } from "./types";
import { BackUpTask, TaskSchedule } from "@45drives/houston-common-lib";
import * as fs from "fs";
import { execSync, spawn } from "child_process";
import * as path from "path";
import { app } from 'electron';
import { getSmbTargetFromSmbTarget } from "../utils";
import { assertSafeHost, assertSafeShare, assertSafeUsername, shellQuote } from "../security";
import { getCredentialManager } from '../credentialManager';
import { syncBackupConfig, getClientId, bashEventSnippet } from './broadcasterApi';
import {
  ensureBackupDaemon,
  ensureUserDirs,
  isDaemonInstalled,
  removeLegacyCronLines,
  MAC_CRED_DIR,
  MAC_STATE_DIR,
  MAC_TASK_DIR,
} from './macDaemon';

/**
 * Bump on any change to getShellScriptContent(). Scripts already on disk are rewritten
 * when their stamp falls behind, so a script fix reaches tasks created before it shipped.
 * The Windows ACTION_BAT_VERSION exists for the same reason.
 */
const TASK_SCRIPT_VERSION = 1;

const LEGACY_SCRIPT_DIR = "/Library/Application Support/Houston/scripts";

/**
 * macOS backups are driven by a LaunchDaemon, not cron, so they fire with nobody signed
 * in. Task scripts and credentials live in the user's own home, so creating, editing,
 * deleting and running a task costs no administrator prompt. The only privileged step is
 * installing the daemon, which happens once per machine.
 */
export class BackUpManagerMac implements BackUpManager {
  protected scriptDir = MAC_TASK_DIR;
  protected logDir = path.join(app.getPath('userData'), 'logs');
  protected HOME = process.env.HOME || `/Users/${process.env.USER}`;
  protected MOUNT_ROOT = `${this.HOME}/houston-mounts`; 
  
  private scriptPathFor(uuid: string): string {
    return path.join(this.scriptDir, `houston-backup-task-${uuid}.sh`);
  }

  private credFileFor(host: string, share: string, username: string): string {
    return path.join(MAC_CRED_DIR, `${host}_${share}_${username}.cred`);
  }

  /** Read a `# KEY="value"` metadata line out of a generated task script. */
  private static header(text: string, key: string): string {
    return (new RegExp(`^#\\s*${key}="([^"]*)"`, 'm').exec(text)?.[1] ?? '').trim();
  }

  /** Reconstruct every task from the scripts in this user's task directory. */
  async queryTasks(): Promise<BackUpTask[]> {
    this.migrateLegacyTasks();

    if (!fs.existsSync(this.scriptDir)) return [];

    const tasks: BackUpTask[] = [];
    for (const file of fs.readdirSync(this.scriptDir)) {
      const m = /^houston-backup-task-([a-f0-9-]+)\.sh$/i.exec(file);
      if (!m) continue;

      let txt = '';
      try {
        txt = fs.readFileSync(path.join(this.scriptDir, file), 'utf8');
      } catch {
        continue;
      }

      const grab = (key: string) => BackUpManagerMac.header(txt, key);
      const schedule = this.parseCronSchedule(grab('TASK_CRON'));
      if (!schedule) continue;

      const source = grab('TASK_SOURCE');
      const target = grab('TASK_TARGET');

      tasks.push({
        uuid: m[1],
        description: `Backup ${source || '(unknown)'} → ${target || '(unknown)'}`,
        name: grab('TASK_NAME') || undefined,
        disabled: grab('TASK_DISABLED') === 'true',
        schedule,
        source,
        target,
        host: grab('TASK_HOST'),
        share: grab('TASK_SHARE'),
        status: 'checking',
        smb_user: grab('TASK_SMB_USER'),
      });
    }

    return tasks;
  }



  /** Write the task script and its runtime credential. No administrator prompt. */
  async schedule(
    task: BackUpTask,
    username: string,
    password: string
  ): Promise<{ stdout: string; stderr: string }> {
    const [host, sharePart] = task.target.split(':');
    const safeHost = assertSafeHost(host);
    const safeShare = assertSafeShare(sharePart.split('/')[0]);
    const safeUser = assertSafeUsername(username);
    task.host = safeHost;
    task.share = safeShare;

    // store() also creates the server record, so the SMB creds never touch login creds
    getCredentialManager().store(safeHost, safeShare, username, password);

    this.prepareRuntime(safeHost, safeShare, safeUser);
    this.writeTaskScript(task, safeUser);

    // Sync backup config to broadcaster API (best-effort, non-blocking)
    syncBackupConfig(safeHost, username, password, task, getClientId()).catch(() => { });

    return { stdout: 'Scheduled via Houston backup daemon', stderr: '' };
  }


  /** Bulk-install many tasks. The daemon check happens once, not once per task. */
  async scheduleAllTasks(
    tasks: BackUpTask[],
    username: string,
    password: string,
    onProgress?: (step: number, total: number, message: string) => void
  ): Promise<void> {
    const total = tasks.length;
    const safeUser = assertSafeUsername(username);
    const clientId = getClientId();
    const prepared = new Set<string>();

    for (let i = 0; i < total; i++) {
      const task = tasks[i];
      const [host, sharePart] = task.target.split(':');
      task.host = assertSafeHost(host);
      task.share = assertSafeShare(sharePart.split('/')[0]);

      // store() also creates the server record, so the SMB creds never touch login creds
      getCredentialManager().store(task.host, task.share, username, password);

      const key = `${task.host}\0${task.share}`;
      if (!prepared.has(key)) {
        prepared.add(key);
        this.prepareRuntime(task.host, task.share, safeUser);
      }

      this.writeTaskScript(task, safeUser);
      syncBackupConfig(task.host, username, password, task, clientId).catch(() => { });
      onProgress?.(i + 1, total, `Scheduled task ${task.uuid}`);
    }
  }

  /**
   * The only path that can escalate: install the LaunchDaemon when it is missing or out
   * of date. Once it is current this is a no-op, so no later task creation, edit or
   * delete produces a prompt.
   */
  private prepareRuntime(host: string, share: string, username: string): void {
    ensureUserDirs();
    getCredentialManager().exportForRuntime(host, share, username);
    ensureBackupDaemon();
    removeLegacyCronLines();
  }

  private writeTaskScript(task: BackUpTask, username: string): void {
    fs.mkdirSync(this.scriptDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.logDir, { recursive: true });
    const scriptPath = this.scriptPathFor(task.uuid);
    fs.writeFileSync(scriptPath, this.getShellScriptContent(task, username), { mode: 0o700 });
    fs.chmodSync(scriptPath, 0o700);
  }

  /**
   * Rewrite a script whose generator version is stale, so script fixes reach tasks that
   * were created before the fix shipped.
   */
  private refreshTaskScript(task: BackUpTask): void {
    const scriptPath = this.scriptPathFor(task.uuid);
    let existing = '';
    try {
      existing = fs.readFileSync(scriptPath, 'utf8');
    } catch {
      return;
    }
    if (BackUpManagerMac.header(existing, 'TASK_SCRIPT_VER') === String(TASK_SCRIPT_VERSION)) return;

    // Metadata that may not survive the IPC round-trip is recovered from the old script.
    const grab = (key: string) => BackUpManagerMac.header(existing, key);
    const username = task.smb_user || grab('TASK_SMB_USER');
    if (!username) return;

    task.host = task.host || grab('TASK_HOST');
    task.share = task.share || grab('TASK_SHARE');
    task.source = task.source || grab('TASK_SOURCE');
    task.target = task.target || grab('TASK_TARGET');
    if (!(task.schedule?.startDate instanceof Date)) {
      const recovered = this.parseCronSchedule(grab('TASK_CRON'));
      if (!recovered) return;
      task.schedule = recovered;
    }

    this.writeTaskScript(task, assertSafeUsername(username));
  }

  /** Run the real task script immediately, as this user. */
  runNow(task: BackUpTask, onProgress?: BackupProgressCallback): Promise<{ stdout: string; stderr: string }> {
    this.refreshTaskScript(task);
    const scriptPath = this.scriptPathFor(task.uuid);

    return new Promise((resolve, reject) => {
      const child = spawn('/bin/bash', [scriptPath], {
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        if (onProgress) {
          if (chunk.includes('[INFO] rsync to')) {
            onProgress(null, 'Running rsync...');
          } else if (chunk.includes('[INFO] Mounting')) {
            onProgress(null, 'Mounting share...');
          }
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
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject({
            message: `Backup task failed with exit code ${code}`,
            stdout,
            stderr,
            code,
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

  /** Remove one task. No administrator prompt, and no credential teardown. */
  async unschedule(task: BackUpTask): Promise<void> {
    this.removeTaskFiles(task.uuid);
  }

  async unscheduleSelectedTasks(tasks: BackUpTask[]): Promise<void> {
    for (const t of tasks) this.removeTaskFiles(t.uuid);
  }

  private removeTaskFiles(uuid: string): void {
    try { fs.unlinkSync(this.scriptPathFor(uuid)); } catch { /* already gone */ }
    for (const suffix of ['lastrun', 'laststatus']) {
      try { fs.unlinkSync(path.join(MAC_STATE_DIR, `${uuid}.${suffix}`)); } catch { /* already gone */ }
    }
  }

  /**
   * Rewrite the script in place. Deliberately not unschedule-then-schedule: that path is
   * what made every macOS schedule edit cost a second administrator prompt.
   */
  async updateSchedule(task: BackUpTask, username: string, password: string): Promise<void> {
    await this.schedule(task, username, password);
  }

  /**
   * True while the next backup still needs the one-time administrator prompt, i.e. until
   * the LaunchDaemon is installed. No task after that one needs it.
   */
  isFirstBackupNeeded(_host: string, _share: string, _smbUser: string): boolean {
    return !isDaemonInstalled();
  }

  /**
   * Carry pre-daemon tasks over. Their scripts lived in a root-owned directory and were
   * driven by cron; the password is still in the login keychain, which is readable here
   * because the user is signed in.
   */
  private migrateLegacyTasks(): void {
    if (!fs.existsSync(LEGACY_SCRIPT_DIR)) return;

    let files: string[] = [];
    try { files = fs.readdirSync(LEGACY_SCRIPT_DIR); } catch { return; }

    for (const file of files) {
      const m = /^houston-backup-task-([a-f0-9-]+)\.sh$/i.exec(file);
      if (!m) continue;
      const uuid = m[1];
      if (fs.existsSync(this.scriptPathFor(uuid))) continue;

      let txt = '';
      try { txt = fs.readFileSync(path.join(LEGACY_SCRIPT_DIR, file), 'utf8'); } catch { continue; }

      const grab = (key: string) => BackUpManagerMac.header(txt, key);
      const host = grab('TASK_HOST');
      const share = grab('TASK_SHARE');
      const smbUser = grab('TASK_SMB_USER');
      const source = grab('TASK_SOURCE');
      const target = grab('TASK_TARGET');
      if (!host || !share || !smbUser || !source || !target) continue;

      const schedule = this.legacyCronScheduleFor(uuid);
      if (!schedule) continue;

      try {
        ensureUserDirs();
        this.migrateLegacyCredential(host, share, smbUser);
        this.writeTaskScript({
          uuid,
          description: `Backup ${source} → ${target}`,
          name: grab('TASK_NAME') || undefined,
          disabled: grab('TASK_DISABLED') === 'true',
          schedule,
          source,
          // Legacy scripts stored TASK_TARGET already stripped of the host:share prefix.
          target: target.startsWith('/') ? `${host}:${share}${target}` : target,
          host,
          share,
          status: 'checking',
          smb_user: smbUser,
        } as BackUpTask, assertSafeUsername(smbUser));
      } catch (err) {
        console.warn(`[BackUpManagerMac] legacy migration failed for ${uuid}:`, err);
      }
    }
  }

  /** Recover a legacy task's schedule from the crontab line that still points at it. */
  private legacyCronScheduleFor(uuid: string): TaskSchedule | null {
    try {
      const crontab = execSync('crontab -l 2>/dev/null || true', { encoding: 'utf8' });
      for (const line of crontab.split(/\r?\n/)) {
        if (!line.includes(`houston-backup-task-${uuid}.sh`)) continue;
        return this.parseCronSchedule(line.trim().split(/\s+/).slice(0, 5).join(' '));
      }
    } catch { /* no crontab */ }
    return null;
  }

  /** Move a legacy keychain secret into the daemon-readable credential file. */
  private migrateLegacyCredential(host: string, share: string, username: string): void {
    if (fs.existsSync(this.credFileFor(host, share, username))) return;

    try {
      getCredentialManager().exportForRuntime(host, share, username);
      return;
    } catch { /* not in the vault — fall back to the login keychain */ }

    const svc = `houston-smb-${host}-${share}-${username}`;
    const password = execSync(
      `security find-generic-password -s ${shellQuote(svc)} -a ${shellQuote(username)} -w 2>/dev/null || true`,
      { encoding: 'utf8' }
    ).trim();
    if (!password) return;

    fs.mkdirSync(MAC_CRED_DIR, { recursive: true, mode: 0o700 });
    const credFile = this.credFileFor(host, share, username);
    fs.writeFileSync(credFile, `username=${username}\npassword=${password}\n`, { mode: 0o600 });
    fs.chmodSync(credFile, 0o600);
  }

  /** Build cron timing for any repeatFrequency. The daemon reads these five fields. */
  protected scheduleToCron(s: TaskSchedule): string {
    const m = s.startDate.getMinutes();
    const h = s.startDate.getHours();
    switch (s.repeatFrequency) {
      case 'hour': return `${m} * * * *`;
      case 'day': return `${m} ${h} * * *`;
      case 'week': return `${m} ${h} * * ${s.startDate.getDay()}`;
      case 'month': return `${m} ${h} ${s.startDate.getDate()} * *`;
      default: return `${m} ${h} * * *`;
    }
  }

  /**
 * Convert the five cron fields into { repeatFrequency, startDate }
 * – supports "*" everywhere, defaulting to 0 / today’s month / today’s weekday.
 */
  protected parseCronSchedule(expr: string): TaskSchedule | null {
    if (!expr) return null;
    const fields = expr.trim().split(/\s+/);
    if (fields.length !== 5) return null;
    const [minS, hourS, domS, monS, dowS] = fields;

    // helper → either numeric value or fallback
    const numOr = (s: string, fallback: number) => (s === '*' ? fallback : +s);

    const now = new Date();                    // today-reference for fallbacks

    const minute = numOr(minS, 0);
    const hour = numOr(hourS, 0);
    const dom = numOr(domS, 1);             // 1 = first of the month
    const mon = numOr(monS, now.getMonth() + 1); // JS months 0-based, cron 1-12
    const dow = numOr(dowS, now.getDay());  // 0-6, Sunday = 0

    /* ---------------- decide frequency ---------------- */
    let repeat: TaskSchedule['repeatFrequency'];

    if (hourS === '*' && domS === '*' && dowS === '*') repeat = 'hour';
    else if (domS === '*' && dowS === '*') repeat = 'day';
    else if (domS === '*' && dowS !== '*') repeat = 'week';
    else if (domS !== '*' && dowS === '*') repeat = 'month';
    else return null;   // anything exotic (ranges, steps, etc.) → unsupported

    /* ---------------- build next startDate ------------- */
    const start = new Date(now);

    switch (repeat) {
      case 'hour':
        start.setMinutes(minute, 0, 0);
        if (start <= now) start.setHours(start.getHours() + 1);
        break;

      case 'day':
        start.setHours(hour, minute, 0, 0);
        if (start <= now) start.setDate(start.getDate() + 1);
        break;

      case 'week': {
        start.setHours(hour, minute, 0, 0);
        const delta = ((dow - start.getDay()) + 7) % 7;
        if (delta === 0 && start <= now) start.setDate(start.getDate() + 7);
        else start.setDate(start.getDate() + delta);
        break;
      }

      case 'month':
        start.setHours(hour, minute, 0, 0);
        start.setDate(dom);
        if (start <= now) {
          start.setMonth(start.getMonth() + 1);
          start.setDate(dom); // roll over safely
        }
        break;
    }

    return { repeatFrequency: repeat, startDate: start };
  }



  private getShellScriptContent(task: BackUpTask, username: string): string {
    const host = assertSafeHost(task.host || task.target.split(':')[0]);
    const share = assertSafeShare(task.share || task.target.split(':')[1].split('/')[0]);
    const mountPoint = `${this.MOUNT_ROOT}/${share}`;
    const target = getSmbTargetFromSmbTarget(task.target);
    const destDir = `${mountPoint}/${target.replace(/^\/+/, '')}`;
    const cron = this.scheduleToCron(task.schedule);

    return (`#!/bin/bash
#
# Generated by 45Drives Storage Wizard. Executed by the Houston backup LaunchDaemon,
# which runs it as this user. Do not edit by hand: it is rewritten whenever
# TASK_SCRIPT_VER falls behind the app.
#
# TASK_SCRIPT_VER="${TASK_SCRIPT_VERSION}"
# TASK_HOST="${host}"
# TASK_SHARE="${share}"
# TASK_SOURCE="${task.source}"
# TASK_TARGET="${task.target}"
# TASK_SMB_USER="${username}"
# TASK_NAME="${(task.name || '').replace(/"/g, '')}"
# TASK_DISABLED="${task.disabled ? 'true' : 'false'}"
# TASK_CRON="${cron}"
# TASK_FREQ="${task.schedule.repeatFrequency}"

set -euo pipefail

EVENT_LOG=${shellQuote(path.join(this.logDir, '45drives_backup_events.json'))}
LOG=${shellQuote(path.join(this.logDir, `Houston_Backup_Task_${task.uuid}.log`))}
UUID=${shellQuote(task.uuid)}
HOST=${shellQuote(host)}
SHARE=${shellQuote(share)}
SMB_USER=${shellQuote(username)}
SOURCE=${shellQuote(task.source)}
TARGET=${shellQuote(target)}
MOUNT_DIR=${shellQuote(mountPoint)}
DEST_DIR=${shellQuote(destDir)}
CRED_FILE=${shellQuote(this.credFileFor(host, share, username))}
CLIENT_ID_FILE=${shellQuote(path.join(app.getPath('userData'), 'client-id.txt'))}
INSTALL_ID="$(cat "$CLIENT_ID_FILE" 2>/dev/null || true)"
DISABLED='${task.disabled ? 'true' : 'false'}'

if [ "$DISABLED" = "true" ]; then
  echo "[INFO] Task is disabled, skipping."
  exit 0
fi

mkdir -p "$(dirname "$LOG")"
if command -v stdbuf >/dev/null 2>&1; then
  exec > >(stdbuf -o0 tee -a "$LOG") 2>&1
else
  exec > >(tee -a "$LOG") 2>&1
fi

WE_MOUNTED=false
BACKUP_ENDED=false

write_backup_end() {
  local end_status="\${1:-failure}"
  if [ "$BACKUP_ENDED" = "false" ]; then
    BACKUP_ENDED=true
    echo '{"event":"backup_end","timestamp":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","uuid":"'"$UUID"'","host":"'"$HOST"'","share":"'"$SHARE"'","source":"'"$SOURCE"'","target":"'"$TARGET"'","status":"'"$end_status"'","install_id":"'"$INSTALL_ID"'","smb_user":"'"$SMB_USER"'"}' >> "$EVENT_LOG"
  fi
}

cleanup() {
  write_backup_end failure
  # Unmount only what this run mounted. The mount point itself is never removed: an
  # unprivileged run cannot recreate one it does not own, and an empty directory is free.
  if [ "$WE_MOUNTED" = "true" ]; then
    /sbin/umount "$MOUNT_DIR" 2>/dev/null \\
      || /usr/sbin/diskutil unmount force "$MOUNT_DIR" >/dev/null 2>&1 \\
      || true
  fi
}
trap cleanup EXIT

echo "===== [$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [INFO] Backup task started: $UUID ====="

echo '{"event":"backup_start","timestamp":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","uuid":"'"$UUID"'","host":"'"$HOST"'","share":"'"$SHARE"'","source":"'"$SOURCE"'","target":"'"$TARGET"'","install_id":"'"$INSTALL_ID"'","smb_user":"'"$SMB_USER"'"}' >> "$EVENT_LOG"

${bashEventSnippet(host, 'start', task.uuid)}

# ---- pre-flight -------------------------------------------------------------
case "$SOURCE" in
  //*|/Volumes/*)
    echo "[ERROR] Network locations are not supported as a backup source: $SOURCE"
    exit 16
    ;;
esac

if [ ! -d "$SOURCE" ]; then
  echo "[ERROR] Backup source does not exist: $SOURCE"
  exit 16
fi

# A TCC denial presents as an unreadable directory, so name the cause here rather than
# letting rsync report a bare permission error at 2am.
if [ ! -r "$SOURCE" ]; then
  echo "[ERROR] Backup source is not readable: $SOURCE"
  echo "[ERROR] Grant Full Disk Access to the Houston backup daemon in System Settings > Privacy & Security > Full Disk Access."
  exit 13
fi

if [ ! -f "$CRED_FILE" ]; then
  echo "[ERROR] No credential file at $CRED_FILE - re-run the backup setup for this server."
  exit 1
fi

PASSWORD="$(grep '^password=' "$CRED_FILE" | head -1 | cut -d= -f2-)"
if [ -z "$PASSWORD" ]; then
  echo "[ERROR] Credential file $CRED_FILE has no password - re-run the backup setup."
  exit 1
fi

# ---- mount ------------------------------------------------------------------
# mount_smbfs is headless. The previous implementation drove Finder through osascript,
# which needs a GUI session and so could never run with the user signed out.
urlenc() {
  local s="\$1" out='' i c
  for (( i = 0; i < \${#s}; i++ )); do
    c="\${s:i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out+="$c" ;;
      *) out+="$(printf '%%%02X' "'$c")" ;;
    esac
  done
  printf '%s' "$out"
}

mkdir -p "$MOUNT_DIR"

if /sbin/mount | grep -q " on $MOUNT_DIR "; then
  echo "[INFO] Already mounted at $MOUNT_DIR"
else
  echo "[INFO] Mounting //$HOST/$SHARE at $MOUNT_DIR"
  if ! /sbin/mount_smbfs -N "//$(urlenc "$SMB_USER"):$(urlenc "$PASSWORD")@$HOST/$SHARE" "$MOUNT_DIR"; then
    echo "[ERROR] SMB mount failed for //$HOST/$SHARE"
    exit 1
  fi
  WE_MOUNTED=true
fi

if ! /sbin/mount | grep -q " on $MOUNT_DIR "; then
  echo "[ERROR] $MOUNT_DIR is not mounted after mount_smbfs reported success"
  exit 1
fi

echo "[SUCCESS] SMB share mounted at $MOUNT_DIR"

# ---- marker -----------------------------------------------------------------
MARKER_UUID="$(printf '%s' "$TARGET" | awk -F/ '{print $2}')"
MARKER_DIR="$MOUNT_DIR/$MARKER_UUID/.houston"
mkdir -p "$MARKER_DIR"
printf '{"install_id":"%s","smb_user":"%s","source":"%s","user":"%s","host":"%s","platform":"mac"}\\n' \\
  "$INSTALL_ID" "$SMB_USER" "$SOURCE" "$(id -un)" "$(hostname -s)" > "$MARKER_DIR/client.json"

# ---- copy -------------------------------------------------------------------
mkdir -p "$DEST_DIR"
echo "[INFO] rsync to $DEST_DIR"

# 'rsync ... || true' is an AND-OR list, not a pipeline, so PIPESTATUS would report the
# status of 'true' and every failure would read as success. Capture \$? directly.
set +e
COPYFILE_DISABLE=1 rsync -a --compress-level=1 --info=progress2 --no-inc-recursive "$SOURCE/" "$DEST_DIR/"
ST=$?
set -e

case "$ST" in
  0)
    echo "[SUCCESS] rsync completed successfully"
    _BCAST_STATUS="success"
    _BCAST_ERROR=""
    EXIT_CODE=0
    ;;
  23|24)
    # 23: some files could not be transferred. 24: files vanished during transfer.
    echo "[WARN] Some files were skipped or vanished during transfer (rsync exit $ST)"
    echo "[SUCCESS] rsync completed with warnings (exit $ST)"
    # Reported as success: the transfer ran, some files were simply not copyable.
    _BCAST_STATUS="success"
    _BCAST_ERROR="rsync exit code $ST"
    EXIT_CODE=0
    ;;
  *)
    echo "[ERROR] rsync failed with exit code $ST"
    _BCAST_STATUS="failure"
    _BCAST_ERROR="rsync exit code $ST"
    EXIT_CODE=$ST
    ;;
esac

write_backup_end "$_BCAST_STATUS"

${bashEventSnippet(host, 'end', task.uuid)}

echo "===== [$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [INFO] Backup task finished: rsync exit $ST ====="
exit $EXIT_CODE
`);
  }

}