import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync, execSync } from "child_process";
import { getAssetSync } from "../utils";
import { shellQuote } from "../security";

/**
 * macOS scheduling runs from a LaunchDaemon rather than cron, so backups fire with no
 * user signed in. Everything a task needs at run time lives in the user's own home, so
 * creating, editing, deleting and running tasks costs zero administrator prompts. The
 * only privileged moment is installing the daemon itself, which happens once per machine
 * and is guarded by a version marker.
 */

/** Bump together with DAEMON_VERSION in src/main/static/mac/houston-backupd. */
export const MAC_DAEMON_VERSION = 1;

export const MAC_DAEMON_LABEL = "com.45drives.houston.backupd";

const DAEMON_ROOT = "/Library/Application Support/45Drives/Houston";
const DAEMON_BIN = `${DAEMON_ROOT}/bin/houston-backupd`;
const DAEMON_MARKER = `${DAEMON_ROOT}/.daemon-version`;
const DAEMON_PLIST = `/Library/LaunchDaemons/${MAC_DAEMON_LABEL}.plist`;

/** Legacy locations retired by the daemon; removed during the same privileged step. */
const LEGACY_SCRIPT_DIR = "/Library/Application Support/Houston/scripts";

export const MAC_SUPPORT_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "45Drives",
  "Houston"
);
export const MAC_TASK_DIR = path.join(MAC_SUPPORT_DIR, "backup-tasks");
export const MAC_STATE_DIR = path.join(MAC_SUPPORT_DIR, "state");
export const MAC_CRED_DIR = path.join(MAC_SUPPORT_DIR, "credentials");
export const MAC_MOUNT_ROOT = path.join(os.homedir(), "houston-mounts");

/** Path users must add to Full Disk Access for TCC-protected sources. */
export const MAC_DAEMON_BIN_PATH = DAEMON_BIN;

export function ensureUserDirs(): void {
  for (const dir of [MAC_TASK_DIR, MAC_STATE_DIR, MAC_MOUNT_ROOT]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.mkdirSync(MAC_CRED_DIR, { recursive: true, mode: 0o700 });
}

export function isDaemonInstalled(): boolean {
  try {
    if (!fs.existsSync(DAEMON_BIN) || !fs.existsSync(DAEMON_PLIST)) return false;
    return fs.readFileSync(DAEMON_MARKER, "utf8").trim() === String(MAC_DAEMON_VERSION);
  } catch {
    return false;
  }
}

export function isDaemonRunning(): boolean {
  try {
    execSync(`/bin/launchctl print system/${MAC_DAEMON_LABEL}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install or upgrade the LaunchDaemon. Costs one administrator prompt the first time and
 * after a version bump; a no-op on every other call.
 */
export function ensureBackupDaemon(): { installed: boolean; reason: string } {
  ensureUserDirs();

  if (isDaemonInstalled()) {
    if (!isDaemonRunning()) {
      // Marker and files are current but launchd has no record — reinstall to re-bootstrap.
      return runInstaller("daemon files present but not loaded");
    }
    return { installed: false, reason: "already installed" };
  }

  return runInstaller(fs.existsSync(DAEMON_BIN) ? "version out of date" : "not installed");
}

function runInstaller(reason: string): { installed: boolean; reason: string } {
  const runnerSrc = getAssetSync("static", path.join("mac", "houston-backupd"));
  const plistSrc = getAssetSync("static", path.join("mac", `${MAC_DAEMON_LABEL}.plist`));

  if (!fs.existsSync(runnerSrc) || !fs.existsSync(plistSrc)) {
    throw new Error(`Backup daemon assets missing (looked for ${runnerSrc})`);
  }

  const currentUser = os.userInfo().username;
  const installer = [
    "#!/bin/bash",
    "set -euo pipefail",
    `mkdir -p ${shellQuote(`${DAEMON_ROOT}/bin`)} /Library/Logs/45Drives`,
    `chown -R root:wheel ${shellQuote(DAEMON_ROOT)}`,
    `chmod 755 ${shellQuote(DAEMON_ROOT)} ${shellQuote(`${DAEMON_ROOT}/bin`)}`,
    `install -m 755 -o root -g wheel ${shellQuote(runnerSrc)} ${shellQuote(DAEMON_BIN)}`,
    `install -m 644 -o root -g wheel ${shellQuote(plistSrc)} ${shellQuote(DAEMON_PLIST)}`,
    `/bin/launchctl bootout system ${shellQuote(DAEMON_PLIST)} 2>/dev/null || true`,
    `/bin/launchctl bootstrap system ${shellQuote(DAEMON_PLIST)} 2>/dev/null || /bin/launchctl load -w ${shellQuote(DAEMON_PLIST)}`,
    `/bin/launchctl enable system/${MAC_DAEMON_LABEL} 2>/dev/null || true`,
    `printf '%s' ${shellQuote(String(MAC_DAEMON_VERSION))} > ${shellQuote(DAEMON_MARKER)}`,
    `chmod 644 ${shellQuote(DAEMON_MARKER)}`,
    "",
    "# Retire the pre-daemon layout in the same prompt.",
    `rm -f ${shellQuote(`/private/etc/sudoers.d/houston-${currentUser}`)}`,
    `rm -rf ${shellQuote(LEGACY_SCRIPT_DIR)}`,
    `rmdir "/Library/Application Support/Houston" 2>/dev/null || true`,
    "",
  ].join("\n");

  const installerPath = path.join(os.tmpdir(), `houston-daemon-install-${Date.now()}.sh`);
  fs.writeFileSync(installerPath, installer, { mode: 0o700 });

  try {
    runAsAdmin(`/bin/bash ${shellQuote(installerPath)}`);
  } finally {
    try {
      fs.unlinkSync(installerPath);
    } catch {
      /* best effort */
    }
  }

  if (!isDaemonInstalled()) {
    throw new Error("Backup daemon installation did not complete — scheduled backups would not run.");
  }

  return { installed: true, reason };
}

function runAsAdmin(cmd: string): void {
  const script = [
    `do shell script ${JSON.stringify(cmd)} with administrator privileges`,
  ].join("\n");
  execFileSync("/usr/bin/osascript", ["-e", script], { encoding: "utf8" });
}

/**
 * Drop the crontab lines written by the pre-daemon implementation. User-level, so no
 * prompt; safe to call on every schedule operation.
 */
export function removeLegacyCronLines(): void {
  try {
    const crontab = execSync("crontab -l 2>/dev/null || true", { encoding: "utf8" });
    const lines = crontab.split(/\r?\n/);
    const kept = lines.filter((l) => !/houston-backup-task-[a-f0-9-]+\.sh/i.test(l));
    if (kept.length === lines.length) return;

    const cleaned = kept.map((l) => l.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      try {
        execSync("crontab -r", { stdio: "ignore" });
      } catch {
        /* no crontab */
      }
      return;
    }
    execSync("crontab -", { input: cleaned.join("\n") + "\n" });
  } catch {
    /* best effort */
  }
}
