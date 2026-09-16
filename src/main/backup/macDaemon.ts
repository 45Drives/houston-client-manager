import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile, execFileSync, execSync } from "child_process";
import { promisify } from "util";
import { getAssetSync } from "../utils";
import { shellQuote } from "../security";

const execFileAsync = promisify(execFile);

/**
 * macOS scheduling runs from a LaunchDaemon rather than cron, so backups fire with no
 * user signed in. Everything a task needs at run time lives in the user's own home, so
 * creating, editing, deleting and running tasks costs zero administrator prompts. The
 * only privileged moment is installing the daemon itself, which happens once per machine
 * and is guarded by a version marker.
 */

/** Bump together with DAEMON_VERSION in src/main/static/mac/StorageWizardBackup.sh. */
export const MAC_DAEMON_VERSION = 5;

export const MAC_DAEMON_LABEL = "com.45drives.houston.backupd";

const DAEMON_ROOT = "/Library/Application Support/45Drives/Houston";
const DAEMON_BIN = `${DAEMON_ROOT}/bin/StorageWizardBackup`;
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

/**
 * Where a share is reachable on this Mac. Backups mount with mount_smbfs under
 * MAC_MOUNT_ROOT, while a Finder/AppleScript mount lands in /Volumes, so neither
 * location can be assumed. Prefer whichever is actually mounted.
 */
export function resolveMacShareRoot(share: string): string {
  const daemonMount = path.join(MAC_MOUNT_ROOT, share);
  const volumesMount = path.join("/Volumes", share);
  for (const candidate of [daemonMount, volumesMount]) {
    try {
      if (fs.readdirSync(candidate).length > 0) return candidate;
    } catch { /* not mounted */ }
  }
  return volumesMount;
}

// ---------------------------------------------------------------------------
// Run locks
//
// The daemon and the app can both start the same task, and they mount the same path. When
// they overlap the first to finish unmounts the share while the other is still writing to
// it, which surfaces as EPERM part-way through a run that was otherwise fine. Both sides
// take this lock, so a task only ever has one runner.
//
// mkdir is the primitive because it is atomic on every filesystem involved and needs no
// daemon round-trip. The pid inside lets either side reclaim a lock left behind by a
// process that was killed — without that, cancelling a backup would block it forever.
// ---------------------------------------------------------------------------

export interface TaskLockInfo {
  pid: number;
  holder: string;
}

function lockDirFor(uuid: string): string {
  return path.join(MAC_STATE_DIR, `${uuid}.lock`);
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM means the pid exists but belongs to another user, e.g. the root daemon.
    return err?.code === "EPERM";
  }
}

export function readTaskLock(uuid: string): TaskLockInfo | null {
  const dir = lockDirFor(uuid);
  if (!fs.existsSync(dir)) return null;
  const read = (name: string): string => {
    try {
      return fs.readFileSync(path.join(dir, name), "utf-8").trim();
    } catch {
      return "";
    }
  };
  return { pid: parseInt(read("pid"), 10) || 0, holder: read("holder") || "unknown" };
}

/** Whoever holds the lock, or null if the task is free to run. */
export function taskLockHolder(uuid: string): TaskLockInfo | null {
  const info = readTaskLock(uuid);
  if (!info) return null;
  if (pidAlive(info.pid)) return info;
  try {
    fs.rmSync(lockDirFor(uuid), { recursive: true, force: true });
  } catch {
    /* the other side may have cleared it first */
  }
  return null;
}

export function acquireTaskLock(uuid: string, pid: number = process.pid): boolean {
  const dir = lockDirFor(uuid);
  fs.mkdirSync(MAC_STATE_DIR, { recursive: true, mode: 0o700 });

  try {
    fs.mkdirSync(dir);
  } catch (err: any) {
    if (err?.code !== "EEXIST") throw err;
    if (taskLockHolder(uuid)) return false;
    try {
      fs.mkdirSync(dir);
    } catch {
      return false;
    }
  }

  try {
    fs.writeFileSync(path.join(dir, "pid"), String(pid));
    fs.writeFileSync(path.join(dir, "holder"), "app");
  } catch {
    /* a lock with no pid is treated as stale, which is the safe direction */
  }
  return true;
}

export function releaseTaskLock(uuid: string): void {
  try {
    fs.rmSync(lockDirFor(uuid), { recursive: true, force: true });
  } catch {
    /* already gone */
  }
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
    for (const name of [
      "StorageWizardBackup",
      "StorageWizardBackup.sh",
      `${MAC_DAEMON_LABEL}.plist`,
      INSTALLER_NAME,
    ]) {
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

/** Append-only trace of every priming attempt; the only window into a flow that must not throw. */
export const MAC_TCC_LOG = path.join(MAC_SUPPORT_DIR, "tcc-prime.log");

function tccLog(message: string): void {
  console.log(`[tcc] ${message}`);
  try {
    fs.mkdirSync(MAC_SUPPORT_DIR, { recursive: true, mode: 0o700 });
    fs.appendFileSync(MAC_TCC_LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    /* logging must never be the thing that breaks task creation */
  }
}

function describeError(err: any): string {
  return `${err?.code ?? err?.name ?? "Error"}: ${err?.message ?? String(err)}`;
}

/**
 * TCC will not present a prompt for a service whose usage-description key is missing from
 * the running bundle's Info.plist — it denies silently. Under `yarn dev` the running
 * bundle is Electron's own, which declares none of them, so no prompt can appear there no
 * matter how correct the rest of this is. Logged so that case is obvious rather than
 * looking like a code failure.
 */
const TCC_USAGE_KEYS = [
  "NSNetworkVolumesUsageDescription",
  "NSRemovableVolumesUsageDescription",
  "NSDesktopFolderUsageDescription",
  "NSDocumentsFolderUsageDescription",
  "NSDownloadsFolderUsageDescription",
];

function logBundleUsageKeys(): void {
  const plist = path.resolve(path.dirname(process.execPath), "..", "Info.plist");
  try {
    // Binary plists still carry the key names as ASCII, so a substring test is enough.
    const raw = fs.readFileSync(plist, "latin1");
    const present = TCC_USAGE_KEYS.filter((key) => raw.includes(key));
    const bundleId = /CFBundleIdentifier[\s\S]{0,80}?([A-Za-z0-9.\-]+\.[A-Za-z0-9.\-]+)/.exec(raw)?.[1] ?? "?";
    tccLog(`bundle=${plist} id=${bundleId} usageKeys=[${present.join(", ") || "NONE"}]`);
    if (!present.includes("NSNetworkVolumesUsageDescription")) {
      tccLog(
        "WARNING: NSNetworkVolumesUsageDescription is absent from the running bundle — " +
        "macOS will deny network-volume access silently and show no prompt. " +
        "This is expected under `yarn dev`; test with a packaged build."
      );
    }
  } catch (err) {
    tccLog(`bundle=${plist} unreadable (${describeError(err)})`);
  }
}

/**
 * Read a directory and then open one real file inside it. The listing alone can be served
 * from cache without a filesystem access, which is not enough to make TCC decide anything.
 */
async function probeRead(label: string, target: string): Promise<void> {
  try {
    const stat = await fs.promises.stat(target);
    if (stat.isFile()) {
      const handle = await fs.promises.open(target, "r");
      await handle.read(Buffer.alloc(1), 0, 1, 0).finally(() => handle.close());
      tccLog(`${label}: read file ${target} ok`);
      return;
    }

    const entries = await fs.promises.readdir(target, { withFileTypes: true });
    tccLog(`${label}: readdir ${target} ok (${entries.length} entries)`);

    const file = entries.find((e) => e.isFile() && !e.name.startsWith("."));
    if (!file) return;
    const handle = await fs.promises.open(path.join(target, file.name), "r");
    await handle.read(Buffer.alloc(1), 0, 1, 0).finally(() => handle.close());
    tccLog(`${label}: read file ${file.name} ok`);
  } catch (err) {
    tccLog(`${label}: FAILED on ${target} (${describeError(err)})`);
  }
}

/**
 * A write is what a backup actually does, and it is the access TCC is most reliably
 * asked about on a network volume. Removed again immediately.
 */
async function probeWrite(label: string, dir: string): Promise<void> {
  const probe = path.join(dir, `.houston-tcc-probe-${process.pid}`);
  try {
    await fs.promises.writeFile(probe, "");
    tccLog(`${label}: write probe ok at ${probe}`);
  } catch (err) {
    tccLog(`${label}: write probe FAILED at ${probe} (${describeError(err)})`);
  } finally {
    try {
      await fs.promises.unlink(probe);
    } catch {
      /* nothing was created */
    }
  }
}

/**
 * Touch everything a task will need so TCC raises its prompts now, during task creation,
 * rather than at the first scheduled run. An unattended run has no GUI session, so TCC
 * denies it silently instead of asking — a user who never saw a prompt would just find
 * failed backups. Prompts raised here are attributed to the app and cover app-initiated
 * runs only; the daemon is a separate executable and still needs its own Full Disk Access
 * grant, which macOS offers no way to request.
 *
 * Every step is best-effort: an unreachable server or a denied folder must not block task
 * creation, because the prompt having been shown is the whole point. Every step is also
 * logged to MAC_TCC_LOG, because "best-effort" otherwise means "fails invisibly".
 *
 * Must stay off the main thread. TCC blocks the calling thread while it asks the user, and
 * the app can only draw that prompt if its run loop is still turning, so a synchronous
 * version stalls until macOS gives up and re-raises the prompt minutes later.
 */
export async function primeTccAccess(
  host: string,
  share: string,
  username: string,
  sources: string[]
): Promise<void> {
  tccLog(`--- prime start host=${host} share=${share} user=${username} sources=${JSON.stringify(sources)}`);
  logBundleUsageKeys();

  for (const source of sources) {
    tccLog(`source ${source} tccProtected=${isTccProtectedPath(source)}`);
    await probeRead("source", source);
  }

  let mountPoint = "";
  try {
    const script = getAssetSync("static", "mount_smb_mac.sh");
    tccLog(`mount: running ${script}`);
    const { stdout, stderr } = await execFileAsync(
      "/bin/bash",
      [script, host, share, username, "silent"],
      { encoding: "utf8", timeout: 60_000 }
    );
    tccLog(`mount: stdout=${stdout.trim()}`);
    if (stderr.trim()) tccLog(`mount: stderr=${stderr.trim()}`);
    mountPoint = JSON.parse(stdout).MountPoint ?? "";
  } catch (err: any) {
    tccLog(
      `mount: FAILED (${describeError(err)})` +
      `${err?.stdout ? ` stdout=${String(err.stdout).trim()}` : ""}` +
      `${err?.stderr ? ` stderr=${String(err.stderr).trim()}` : ""}`
    );
  }

  // Separate from the mount: the network-volume prompt is raised by touching the volume,
  // not by mounting it. Trust the mountpoint the script reported, since an empty share
  // looks unmounted to resolveMacShareRoot().
  const target = mountPoint || resolveMacShareRoot(share);
  tccLog(`volume: probing ${target} (reported=${mountPoint || "none"})`);
  await probeRead("volume", target);
  await probeWrite("volume", target);

  tccLog("--- prime end");
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
