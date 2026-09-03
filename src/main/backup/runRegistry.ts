import { ChildProcess, execFile } from 'child_process';
import type { CancelResult } from './types';

/**
 * Stopping a backup has to cover two cases: a run the app started, where the child is in
 * hand, and a run cron or the macOS daemon started, where the only handle is the uuid in
 * the script's command line. Both end up here.
 */

const children = new Map<string, ChildProcess>();

/** UUID from a task, interpolated into a pkill pattern, so it is checked before it gets there. */
export function isSafeUuid(uuid: unknown): uuid is string {
  return typeof uuid === 'string' && /^[0-9a-fA-F-]{8,64}$/.test(uuid);
}

export function trackRun(uuid: string, child: ChildProcess): void {
  children.set(uuid, child);
  child.once('close', () => {
    if (children.get(uuid) === child) children.delete(uuid);
  });
}

export function untrackRun(uuid: string): void {
  children.delete(uuid);
}

export function isTracked(uuid: string): boolean {
  return children.has(uuid);
}

/**
 * Task scripts are Houston_Backup_Task_<uuid>.sh on Linux and houston-backup-task-<uuid>.sh
 * on macOS. Matching the script name rather than the bare uuid matters: the uuid also shows
 * up in backup destination paths, so a looser pattern could hit a mount or status helper.
 */
function runPattern(uuid: string): string {
  return `(Houston_Backup_Task_|houston-backup-task-)${uuid}`;
}

function pkill(uuid: string, signal: '-TERM' | '-KILL'): Promise<boolean> {
  return new Promise(resolve => {
    execFile('pkill', [signal, '-f', runPattern(uuid)], err => resolve(!err));
  });
}

function pgrep(uuid: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile('pgrep', ['-f', runPattern(uuid)], (err, stdout) => resolve(!err && stdout.trim() !== ''));
  });
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Terminate a running backup on Linux/macOS.
 *
 * The script is spawned detached so it leads its own process group; signalling the group
 * is what reaches rsync, which is where the time is actually spent. The script's TERM trap
 * then unmounts the share and records the run as cancelled.
 */
export async function cancelUnixRun(uuid: string): Promise<CancelResult> {
  if (!isSafeUuid(uuid)) return { cancelled: false, method: 'none' };

  const child = children.get(uuid);
  let method: CancelResult['method'] = 'none';

  if (child?.pid) {
    method = 'child';
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
  }

  // A daemon- or cron-started run has no child here, and a group signal can miss a
  // process that re-parented, so match on the script name in the command line either way.
  const matched = await pkill(uuid, '-TERM');
  if (matched && method === 'none') method = 'process';

  for (let i = 0; i < 10; i++) {
    await wait(500);
    if (!(await pgrep(uuid))) return { cancelled: method !== 'none', method };
  }

  // Still alive after 5s: the trap is not going to run, so take the mount cleanup loss.
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  await pkill(uuid, '-KILL');
  return { cancelled: method !== 'none', method };
}
