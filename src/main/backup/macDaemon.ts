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
export const MAC_DAEMON_VERSION = 2;

export const MAC_DAEMON_LABEL = "com.45drives.houston.backupd";

const DAEMON_ROOT = "/Library/Application Support/45Drives/Houston";
const DAEMON_BIN = `${DAEMON_ROOT}/bin/houston-backupd`;
const DAEMON_MARKER = `${DAEMON_ROOT}/.daemon-version`;
const DAEMON_FDA_STATUS = `${DAEMON_ROOT}/fda-status`;
const DAEMON_PLIST = `/Library/LaunchDaemons/${MAC_DAEMON_LABEL}.plist`;
const INSTALLER_NAME = "install-daemon.sh";

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
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "houston-daemon-"));

  try {
    // The shipped assets may live inside app.asar, which install(1) and friends cannot read.
    // Copying them out through fs works in dev and packaged alike.
    for (const name of ["houston-backupd", `${MAC_DAEMON_LABEL}.plist`, INSTALLER_NAME]) {
      const src = getAssetSync("static", path.join("mac", name));
      if (!fs.existsSync(src)) {
        throw new Error(`Backup daemon assets missing (looked for ${src})`);
      }
      fs.copyFileSync(src, path.join(stageDir, name));
    }
    fs.chmodSync(path.join(stageDir, INSTALLER_NAME), 0o700);

    const cmd = `/bin/bash ${shellQuote(path.join(stageDir, INSTALLER_NAME))} --source ${shellQuote(stageDir)}`;
    runAsAdmin(cmd);
  } finally {
    try {
      fs.rmSync(stageDir, { recursive: true, force: true });
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

export type FdaStatus = "granted" | "denied" | "unknown";

/**
 * Whether the daemon currently holds Full Disk Access. The daemon writes this on every
 * wake by probing the system TCC database, so it reflects the daemon's own grant rather
 * than the app's — the two are separate executables and TCC keys grants per executable.
 * "unknown" means the daemon has not run yet.
 */
export function getDaemonFdaStatus(): FdaStatus {
  try {
    const raw = fs.readFileSync(DAEMON_FDA_STATUS, "utf8").trim();
    return raw === "granted" || raw === "denied" ? raw : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * TCC gates these locations even for root. Sources anywhere else need no grant at all,
 * which is most of them, so only warn when it actually matters.
 */
export function isTccProtectedPath(source: string): boolean {
  const home = os.homedir();
  const resolved = path.resolve(source);
  const protectedRoots = [
    path.join(home, "Desktop"),
    path.join(home, "Documents"),
    path.join(home, "Downloads"),
    path.join(home, "Library", "Mobile Documents"),
    path.join(home, "Pictures", "Photos Library.photoslibrary"),
    "/Volumes",
  ];
  return protectedRoots.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );
}

/** Apple provides no API to request Full Disk Access, so the best we can do is open the pane. */
export function openFullDiskAccessSettings(): void {
  try {
    execFileSync("/usr/bin/open", [
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    ]);
  } catch {
    /* best effort */
  }
}

/** Reveal the daemon binary in Finder so it can be dragged into the Full Disk Access list. */
export function revealDaemonBinary(): void {
  try {
    execFileSync("/usr/bin/open", ["-R", DAEMON_BIN]);
  } catch {
    /* best effort */
  }
}

/**
 * Drop the crontab lines written by the pre-daemon implementation. User-level, so no
 * prompt; safe to call on every schedule operation.
 */export function removeLegacyCronLines(): void {
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
