import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import { getOS } from '../utils';
import { MAC_STATE_DIR } from './macDaemon';

/**
 * Progress for scheduled backups.
 *
 * A run started by the macOS LaunchDaemon, a Linux cron job or the Windows scheduler has no
 * pipe back to the app, so percentages could only ever be shown for Run Now. Task scripts
 * therefore publish progress to disk and this watcher republishes it, which also means the
 * app can join a backup that started before it was opened.
 */

export const LIN_STATE_DIR = path.join(os.homedir(), '.local', 'share', 'houston-backups', 'state');

/** Where task scripts drop `<uuid>.progress`. Windows reports through its console log instead. */
export function progressDir(): string | null {
  if (os.platform() === 'darwin') return MAC_STATE_DIR;
  if (os.platform() === 'linux') return LIN_STATE_DIR;
  return null;
}

export type ProgressEmitter = (taskUuid: string, percent: number | null, message?: string) => void;

/** Windows logs are only treated as live while robocopy is still appending to them. */
const WIN_STALE_MS = 90_000;

let timer: NodeJS.Timeout | null = null;
const lastSent = new Map<string, string>();

function readJsonProgress(dir: string, emit: ProgressEmitter): void {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.progress'));
  } catch {
    return;
  }

  const seen = new Set<string>();
  for (const file of files) {
    const uuid = file.slice(0, -'.progress'.length);
    seen.add(uuid);

    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch {
      continue;
    }
    if (raw === lastSent.get(uuid)) continue;

    try {
      const { percent, message } = JSON.parse(raw);
      emit(uuid, typeof percent === 'number' ? percent : null, message);
      lastSent.set(uuid, raw);
    } catch {
      /* caught mid-rename; the next tick reads the finished file */
    }
  }
  prune(seen);
}

/**
 * robocopy has no progress-file equivalent, but the action script already self-captures its
 * console output, so that file is both the progress source and the liveness signal.
 */
function readWindowsConsoleLogs(emit: ProgressEmitter): void {
  const logDir = path.join(app.getPath('userData'), 'logs');
  let files: string[];
  try {
    files = fs.readdirSync(logDir).filter(f => f.endsWith('.console.log'));
  } catch {
    return;
  }

  const seen = new Set<string>();
  for (const file of files) {
    const match = file.match(/^Houston_Backup_Task_(.+)\.console\.log$/);
    if (!match) continue;
    const uuid = match[1];

    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(logDir, file));
    } catch {
      continue;
    }
    if (Date.now() - stat.mtimeMs > WIN_STALE_MS) continue;
    seen.add(uuid);

    const tail = readTail(path.join(logDir, file), stat.size, 8192);
    if (tail === null) continue;

    const percentMatches = [...tail.matchAll(/(\d+(?:\.\d+)?)%/g)];
    let percent: number | null = null;
    let message = 'Copying files...';

    if (percentMatches.length > 0) {
      percent = Math.round(parseFloat(percentMatches[percentMatches.length - 1][1]));
    } else if (tail.includes('Mapping')) {
      message = 'Mounting share...';
    } else {
      // /MT suppresses robocopy's percentage lines, so fall back to counting copied files.
      const copied = tail.split('\n').filter(
        l => /^[\t ]+(New File|Newer|Older|Same|Changed|modified|new file|\*EXTRA File)\b/i.test(l)
      ).length;
      if (copied > 0) message = `Copied ${copied} files...`;
    }

    const key = `${percent}|${message}`;
    if (key === lastSent.get(uuid)) continue;
    emit(uuid, percent, message);
    lastSent.set(uuid, key);
  }
  prune(seen);
}

function readTail(file: string, size: number, bytes: number): string | null {
  const start = Math.max(0, size - bytes);
  const buf = Buffer.alloc(size - start);
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

function prune(seen: Set<string>): void {
  for (const uuid of [...lastSent.keys()]) {
    if (!seen.has(uuid)) lastSent.delete(uuid);
  }
}

export function startBackupProgressWatcher(emit: ProgressEmitter): void {
  if (timer) return;

  const dir = progressDir();
  if (!dir && getOS() !== 'win') return;


  timer = setInterval(() => {
    if (dir) readJsonProgress(dir, emit);
    else readWindowsConsoleLogs(emit);
  }, 1000);

  timer.unref?.();
}
