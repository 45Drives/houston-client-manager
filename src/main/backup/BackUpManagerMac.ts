import log from 'electron-log';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
console.log = (...args) => log.info(...args);
console.error = (...args) => log.error(...args);
console.warn = (...args) => log.warn(...args);
console.debug = (...args) => log.debug(...args);

process.on('uncaughtException', (error) => log.error('Uncaught Exception:', error));
process.on('unhandledRejection', (reason, promise) => log.error('Unhandled Rejection at:', promise, 'reason:', reason));

import { BackUpManager } from "./types";
import { BackUpTask, TaskSchedule } from "@45drives/houston-common-lib";
import * as fs from "fs";
import * as os from "os";
import { execSync } from "child_process";
import * as path from "path";
import { getRsync, getSmbTargetFromSmbTarget } from "../utils";

export class BackUpManagerMac implements BackUpManager {
  protected scriptDir = "/Library/Application Support/Houston/scripts";
  protected logDir = "/Library/Logs/Houston";
  protected HOME = process.env.HOME || `/Users/${process.env.USER}`;
  protected MOUNT_ROOT = `${this.HOME}/houston-mounts`; 
  
  /** Read crontab, reconstruct every task + its schedule */
  async queryTasks(): Promise<BackUpTask[]> {
    const crontab = execSync('crontab -l 2>/dev/null || true', { encoding: 'utf8' });
    const tasks: BackUpTask[] = [];

    // cron: 5 timing fields … anything … houston-backup-task-<uuid>.sh
    const cronRx = /^(\S+\s+\S+\s+\S+\s+\S+\s+\S+).*houston-backup-task-([a-f0-9\-]+)\.sh/i;

    for (const line of crontab.split(/\r?\n/)) {
      const m = cronRx.exec(line);
      if (!m) continue;

      /* ----------- 1. schedule comes from the 5 cron fields ---------- */
      const cronExpr = m[1];
      const schedule = this.parseCronSchedule(cronExpr);
      if (!schedule) continue;                    // exotic pattern → skip

      /* ----------- 2. the uuid gives us the script path -------------- */
      const uuid = m[2];
      const scriptPath = path.join(this.scriptDir, `houston-backup-task-${uuid}.sh`);

      /* ----------- 3. pull metadata out of the script ---------------- */
      let host = '', share = '', source = '', target = ''; let mirror = false;

      if (fs.existsSync(scriptPath)) {
        const txt = fs.readFileSync(scriptPath, 'utf8');

        const grab = (re: RegExp) => (re.exec(txt)?.[1] ?? '').trim();

        host = grab(/#\s*TASK_HOST="([^"]+)"/);
        share = grab(/#\s*TASK_SHARE="([^"]+)"/);
        source = grab(/#\s*TASK_SOURCE="([^"]+)"/);
        target = grab(/#\s*TASK_TARGET="([^"]+)"/);
        mirror = /#\s*TASK_MIRROR="true"/i.test(txt);
      }

      /* fallbacks for source/target if metadata missing */
      if (!source || !target) {
        const rsync = /rsync\s+[^\n]*?"([^"]+?)\/"\s+"([^"]+?)\/"/.exec(
          fs.readFileSync(scriptPath, 'utf8'));
        if (rsync) { source = source || rsync[1]; target = target || rsync[2]; }
      }

      tasks.push({
        uuid,
        description: `Backup ${source || '(unknown)'} → ${target || '(unknown)'}`,
        schedule,
        source, target, host, share, mirror,
        status: 'checking'
      });
    }

    return tasks;
  }



  /** Write script + cron line with ONE privileged prompt */
  schedule(
    task: BackUpTask,
    username: string,
    password: string
  ): Promise<{ stdout: string; stderr: string }> {

    /* ---------- paths & vars ---------- */
    const uuid = task.uuid;
    const scriptPath = path.join(this.scriptDir, `houston-backup-task-${uuid}.sh`);
    const logFile = `${this.logDir}/Houston_Backup_Task_${uuid}.log`;

    /* host/share already filled in the caller, but make sure: */
    const [host, sharePart] = task.target.split(':');
    const share = sharePart.split('/')[0];
    task.host = host;
    task.share = share;

    const installerPath = `/tmp/houston-installer-${uuid}.sh`;
    const scriptPayload = this.getShellScriptContent(task, username);   // big bash body
    const mntRoot = `${this.HOME}/houston-mounts`;
    const mntDir  = `${mntRoot}/${share}`;
    const homeDir = os.homedir();
    const currentUser = os.userInfo().username;
    const userGroup = require("child_process").execSync(`id -gn ${currentUser}`).toString().trim();
    const service = `houston-smb-${share}`;
    const installer = `#!/bin/bash
    set -e
    
    # 1 ─ one-time directories (no special permissions needed later)
    
    mkdir -p "${this.scriptDir}" "${this.logDir}" "${mntRoot}"
    # Check if the path exists (dir or symlink)
    if [ ! -e "${mntDir}" ]; then
        mkdir -p "${mntDir}"
        ln -s "/Volumes/${task.share}" "${mntRoot}"
    fi 
 

    # 2 ─ system key-chain secret
    security delete-generic-password -s "${service}" -a "${username}" 2>/dev/null || true
    security add-generic-password    -s "${service}" -a "${username}" -w "${password}" -U
    
    # 3 ─ write the task script
    cat <<'EOF_${uuid}' > "${scriptPath}"
    ${scriptPayload}
EOF_${uuid}
     chmod 755 "${scriptPath}"

    # 4 ─ let this user mount/umount the share without a password
    echo "${username} ALL=(root) NOPASSWD: /sbin/mount_smbfs, /sbin/umount" \
        > /private/etc/sudoers.d/houston-${username}
     chmod 440 /private/etc/sudoers.d/houston-${username}
    `;

    fs.writeFileSync(installerPath, installer, { mode: 0o700 });

    /* ---------- single privilege prompt ---------- */
    this.runAsAdmin(`bash "${installerPath}"`, "Installing backup task…");

    /* ---------- cron line (no sudo needed) ---------- */
    const cronLine = this.generateCronLine(task, scriptPath, logFile);
    const existing = execSync("crontab -l 2>/dev/null || true", { encoding: "utf8" })
      .split(/\r?\n/)
      .filter(l => !l.includes(scriptPath));         // drop any old line
    this.applyCleanedCrontab([...existing, cronLine]);

    return Promise.resolve({ stdout: "", stderr: "" });
  }


  /** Bulk-install many tasks with a single privileged prompt */
  async scheduleAllTasks(
    tasks: BackUpTask[],
    username: string,
    password: string,
    onProgress?: (step: number, total: number, message: string) => void
  ): Promise<void> {
    
    const total = tasks.length;
    const scriptDir = this.scriptDir;          // “/Library/Application Support/Houston/scripts”
    const logDir = this.logDir;             // “/Library/Logs/Houston”
    // const homeDir = os.homedir();
    const currentUser = os.userInfo().username;
    const userGroup = require("child_process").execSync(`id -gn ${currentUser}`).toString().trim();
    const servicePrefix = "houston-smb-";

    /* ------------------------------------------------------------------
       1.  BUILD a root-only installer shell script as one big heredoc
    ------------------------------------------------------------------ */
    const installerLines: string[] = [
      "#!/bin/bash",
      "set -e",                                            // Stop on first error
      `mkdir -p "${scriptDir}" "${logDir}"`,
      `chmod 1777 "${logDir}"`
    ];

    /* 1a ─ System-keychain credentials (once per share) */
    const uniqueShares = new Set<string>();
    for (const t of tasks) {
      const share = t.share || t.target.split(":")[1].split("/")[0];
      uniqueShares.add(share);
    }
    for (const share of uniqueShares) {
      const svc = servicePrefix + share;

      installerLines.push(
        `security delete-generic-password -s "${svc}" -a "${username}" 2>/dev/null || true`,
        `security add-generic-password -s "${svc}" -a "${username}" -w "${password}" -U`,
        `rm -rf "${this.HOME}/houston-mounts/${share}"`,
        `mkdir -p "${this.HOME}/houston-mounts/${share}"`
      );
    }

    /* 1b ─ One shell script per task */
    for (const task of tasks) {
      const uuid = task.uuid;
      const scriptPath = path.join(scriptDir, `houston-backup-task-${uuid}.sh`);
      const scriptBody = this.getShellScriptContent(task, username)
        // heredoc must not contain an unescaped EOF on its own line
        .replace(/\\EOF/g, '\\\\EOF');

        installerLines.push(
          `cat <<EOF_${uuid} > "${scriptPath}"`,
          scriptBody,
          "EOF_${uuid}",
          `chmod 1777 "${scriptPath}"`
        );
    }

    /* ------------------------------------------------------------------
       2.  WRITE installer to /tmp and run it once under sudo
    ------------------------------------------------------------------ */
    const tmpInstaller = `/tmp/houston-bulk-installer-${Date.now()}.sh`;
    fs.writeFileSync(tmpInstaller, installerLines.join("\n"), { mode: 0o700 });

    this.runAsAdmin(`bash "${tmpInstaller}"`, "Installing all backup tasks…");

    /* ------------------------------------------------------------------
       3.  UPDATE the user crontab (no privileges required)
    ------------------------------------------------------------------ */
    const crontabLines = execSync("crontab -l 2>/dev/null || true", { encoding: "utf8" })
      .split(/\r?\n/);

    /* remove any existing lines that point at our tasks */
    const cleaned = crontabLines.filter(
      l => !tasks.some(t => l.includes(`houston-backup-task-${t.uuid}.sh`))
    );

    /* add fresh cron lines */
    for (const task of tasks) {
      const scriptPath = path.join(scriptDir, `houston-backup-task-${task.uuid}.sh`);
      const logFile = path.join(logDir, `Houston_Backup_Task_${task.uuid}.log`);
      cleaned.push(this.generateCronLine(task, scriptPath, logFile));
    }

    /* write back the new crontab */
    this.applyCleanedCrontab(cleaned);

    /* ------------------------------------------------------------------
       4.  Progress callbacks
    ------------------------------------------------------------------ */
    tasks.forEach((task, i) =>
      onProgress?.(i + 1, total, `Scheduled task ${task.uuid}`)
    );
  }

  /** Immediately execute the real task script (no tmp wrapper) */
  runNow(task: BackUpTask): Promise<{ stdout: string; stderr: string }> {
    const scriptPath = path.join(
      this.scriptDir,
      `houston-backup-task-${task.uuid}.sh`
    );

    try {
      const stdout = execSync(`/bin/bash "${scriptPath}"`, {
        encoding: "utf8",
        stdio: ['ignore', 'pipe', 'pipe'], // Explicitly capture stdout and stderr
      });
      return Promise.resolve({ stdout, stderr: "" });
    } catch (err: any) {
      return Promise.reject({
        message: `Backup task failed: ${err.message}`,
        stdout: err.stdout?.toString?.() ?? "",
        stderr: err.stderr?.toString?.() ?? "",
        code: err.status ?? err.code ?? "unknown",
      });
    }
  }

  /** Remove one cron + script */
  async unschedule(task: BackUpTask): Promise<void> {
    const scriptPath = path.join(this.scriptDir, `houston-backup-task-${task.uuid}.sh`);
    const existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' }).split(/\r?\n/);
    const filtered = existing.filter(l => !l.includes(scriptPath));
    this.applyCleanedCrontab(filtered);
    try { fs.unlinkSync(scriptPath); } catch { }
  }

  /** Remove multiple */
  async unscheduleSelectedTasks(tasks: BackUpTask[]): Promise<void> {
    const existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' }).split(/\r?\n/);
    const filtered = existing.filter(line => !tasks.some(t => line.includes(`houston-backup-task-${t.uuid}.sh`)));
    this.applyCleanedCrontab(filtered);
    for (const t of tasks) {
      try { fs.unlinkSync(path.join(this.scriptDir, `houston-backup-task-${t.uuid}.sh`)); } catch { }
    }
  }

  /** Replace schedule by unscheduling then rescheduling */
  async updateSchedule(task: BackUpTask, username: string, password: string): Promise<void> {
    await this.unschedule(task);
    await this.schedule(task, username, password);
  }

  private runAsAdmin(cmd: string, message: string): void {
    execSync(`osascript -e 'display dialog "${message.replace(/"/g, '\\"')}" with title "Backup Scheduler" buttons {"OK"} default button 1'`);
    execSync(`osascript -e 'do shell script "${this.escapeForAppleScript(cmd)}" with administrator privileges'`);
  }

  private escapeForAppleScript(cmd: string): string {
    return cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  /** Build cron timing for any repeatFrequency */
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

  /** Compose full cron line with comment tag */
  protected generateCronLine(task: BackUpTask, scriptPath: string, logFile: string): string {
    const cron = this.scheduleToCron(task.schedule);
    const iso = task.schedule.startDate.toISOString();
    const tag = `# TASK start=${iso} src=${task.source} tgt=${task.target}`;
    return `${cron} /bin/bash "${scriptPath}" >> "${logFile}" 2>&1 ${tag}`;
  }

  /** Parse a cron line back into a full BackUpTask */
  protected cronToBackupTask(line: string): BackUpTask | null {
    const parts = line.split(/\s+/);
    const sched = this.parseCronSchedule(parts.slice(0, 5).join(' '));
    if (!sched) return null;
    const scriptPart = parts.find(p => p.includes('houston-backup-task-'));
    if (!scriptPart) return null;
    const uuidMatch = scriptPart.match(/houston-backup-task-(.+?)\.sh/);
    if (!uuidMatch) return null;
    const uuid = uuidMatch[1];
    const matchTag = line.match(/#\s*TASK\s+start=([^\s]+)\s+src=([^\s]+)\s+tgt=([^\s]+)/);
    const [, , src, tgt] = matchTag || [];
    // re-read script for host/share/mirror
    const scriptPath = path.join(this.scriptDir, `houston-backup-task-${uuid}.sh`);
    const content = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
    const hostMatch = content.match(/# TASK_HOST="(.+)"/);
    const shareMatch = content.match(/# TASK_SHARE="(.+)"/);
    const mirror = content.includes('--delete');
    return {
      uuid,
      description: `Backup ${src} → ${tgt}`,
      schedule: sched,
      source: src || '',
      target: tgt || '',
      host: hostMatch ? hostMatch[1] : '',
      share: shareMatch ? shareMatch[1] : '',
      mirror,
      status: 'checking'
    };
  }

  /**
 * Convert the first 5 cron fields into { repeatFrequency, startDate }
 * – supports "*" everywhere, defaulting to 0 / today’s month / today’s weekday.
 */
  protected parseCronSchedule(expr: string): TaskSchedule | null {
    const [minS, hourS, domS, monS, dowS] = expr.trim().split(/\s+/);

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



  /** Install a cleaned crontab – or erase it safely when empty */
  protected applyCleanedCrontab(lines: string[]): void {
    const cleaned = lines.map(l => l.trim()).filter(Boolean);

    if (cleaned.length === 0) {
      // remove crontab; ignore “no crontab for user” exit-code
      try { execSync("crontab -r", { stdio: "ignore" }); } catch { /* noop */ }
      return;
    }

    // push the lines to stdin of `crontab -`  → no quoting issues
    const input = cleaned.join("\n") + "\n";
    execSync("crontab -", { input });
  }

  private getShellScriptContent(task: BackUpTask, username: string): string {
    const mountRoot = this.MOUNT_ROOT;
    const mountPoint = `${mountRoot}/${task.share}`;
    const volumesMount = `/Volumes/${task.share}`;
    const rel = task.target!.split('/').slice(1).join('/');
    const dir = `${mountPoint}/${rel}`;
    const svc = `houston-smb-${task.share}`;
    const target = getSmbTargetFromSmbTarget(task.target);
    const rsyncCmd = `${getRsync()} -a${task.mirror ? ' --delete' : ''} "${task.source}/" "${dir}/"`;
    return (`
  #!/bin/bash
  trap 'st=$?; echo "===== $(/bin/date -u "+%Y-%m-%dT%H:%M:%SZ") END $st ====="; exit $st' EXIT
  # Houston user-level backup script
  # TASK_HOST="${task.host}"
  # TASK_SHARE="${task.share}"
  # TASK_SOURCE="${task.source}"
  # TASK_TARGET="${target}"
  # TASK_MIRROR="${task.mirror}"
  # TASK_START="${task.schedule.startDate.toISOString()}"
  START_DATE='${task.schedule.startDate.toISOString()}'
  LOG="${this.logDir}/Houston_Backup_Task_${task.uuid}.log"
  mkdir -p "$(dirname "$LOG")"
  exec >>"$LOG" 2>&1
  set -x
  echo "===== $(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ') START ${task.uuid} ====="
  set +x
  PASSWORD=$(security find-generic-password -s "${svc}" -a "${username}" -w) || {
    echo "[ERROR] key-chain lookup failed"
    exit 1
  }
  set -x

  # ---------- (1) try Finder / user-level mount first ----------
  if ! /sbin/mount | /usr/bin/grep -qE "${mountPoint}|${volumesMount}"; then
    set +x
    /usr/bin/osascript <<EOT
      try
        mount volume "smb://${username}:$PASSWORD@${task.host}/${task.share}"
      end try
EOT
    set -x

    sleep 2  # give Finder a moment to finish the mount

    real_mnt=$(/sbin/mount | grep "${username}@${task.host}/${task.share}" | awk '{ print $3; exit }')
    if [ -z "$real_mnt" ]; then
      echo "[ERROR] SMB mount failed or volume not detected"
      exit 1
    fi

    if [ "$real_mnt" != "${mountPoint}" ]; then
      [ -d "${mountPoint}" ] && rmdir "${mountPoint}" 2>/dev/null || true
      ln -snf "$real_mnt" "${mountPoint}"
    fi
  fi
  mkdir -p "${dir}"
  echo "[INFO] rsync to ${dir}"
  ${rsyncCmd}
    `).trimStart();
  }
}