import { NodeSSH, SSHExecCommandResponse } from 'node-ssh';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, execSync } from 'child_process';
import { checkSSH, connectWithFallback } from './setupSsh';
import { getAgentSocket, getKeyDir, ensureKeyPair } from './crossPlatformSsh';
import { assertSafeHost, assertSafeUsername, shellQuote } from './security';
import { loadSettings } from './settingsStore';
import { getMountSmbScript } from './utils';
import { getCredentialManager } from './credentialManager';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RemoteEntry {
  name: string;       // e.g. "gdrive:" or "dropbox:"
  type: string;       // e.g. "drive", "dropbox", "s3"
}

export interface RemoteFileEntry {
  Path: string;
  Name: string;
  Size: number;
  MimeType: string;
  ModTime: string;
  IsDir: boolean;
}

export interface ServerFileEntry {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
  modTime: string;
}

export interface S2STask {
  name: string;
  localPath: string;
  remoteHost: string;
  remotePort: number;
  remoteUser: string;
  remotePath: string;
  direction: 'push' | 'pull';
}

export interface ZfsReplicationTaskInfo {
  name: string;
  sourceDataset: string;
  destDataset: string;
  destHost: string;
  destUser: string;
  destSshPort: number;
  direction: 'push' | 'pull';
}

export interface ReplicationAnchor {
  /** Full snapshot name on the local side (dataset@snapname) */
  snapshotName: string;
  /** Short snapshot name (just the @name part) */
  snapName: string;
  /** Replication tasks this snapshot anchors */
  tasks: Array<{
    name: string;
    /** Human-readable description like "user@host:pool/dataset" */
    target: string;
  }>;
}

export interface RestoreRequest {
  serverIp: string;
  username: string;
  /** Source: rclone remote name (e.g. "gdrive:") or "server" for rsync/local */
  source: string;
  /** Path on the remote or server to restore from */
  sourcePath: string;
  /** Destination path on the target machine */
  destPath: string;
  /** Where to restore to: "server" = onto the server, "client" = download to client machine */
  target: 'server' | 'client';
  /** If target=client, the SMB share to stage files to for client pull */
  smbShare?: string;
  smbUser?: string;
  smbPass?: string;
}

export interface RestoreResult {
  success: boolean;
  filesRestored?: number;
  bytesTransferred?: number;
  error?: string;
  /** If target=client, the path where files were staged on the SMB share */
  stagedPath?: string;
}

export interface ZfsDataset {
  name: string;
  mountpoint: string;
  used: string;
  available: string;
  /** Space charged to `used` purely by refreservation, not by actual data. */
  usedbyrefreservation?: string;
}

export interface ZfsSnapshot {
  name: string;        // dataset@snapname
  dataset: string;
  snapName: string;
  creation: string;
  used: string;
  referenced: string;
}

export interface SnapshotRollbackResult {
  success: boolean;
  dataset: string;
  snapshot: string;
  error?: string;
}

export interface SnapshotCreateResult {
  success: boolean;
  snapshotName?: string;
  error?: string;
}

export interface SnapshotDestroyResult {
  success: boolean;
  error?: string;
}

export interface SnapshotFileEntry {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
  modTime: number;
}

export interface SnapshotRestoreResult {
  success: boolean;
  filesRestored?: number;
  error?: string;
}

// ── Progress callback ────────────────────────────────────────────────────────

export type RestoreProgressCallback = (progress: {
  operationId: string;
  phase: 'listing' | 'downloading' | 'staging' | 'copying' | 'complete' | 'error';
  currentFile?: string;
  filesProcessed?: number;
  filesTotal?: number;
  bytesProcessed?: number;
  bytesTotal?: number;
  message?: string;
  error?: string;
}) => void;

// ── SSH helper ───────────────────────────────────────────────────────────────

async function connectSSH(host: string, username: string, password?: string): Promise<NodeSSH> {
  const safeHost = assertSafeHost(host);
  const safeUser = assertSafeUsername(username);
  return connectWithFallback(safeHost, { username: safeUser, method: 'password', password });
}

function assertCommandSuccess(result: SSHExecCommandResponse, context: string): string {
  if (result.code !== 0 && result.code !== null) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${context} failed (exit ${result.code}): ${detail}`);
  }
  return result.stdout;
}

// ── Cloud / rclone operations ────────────────────────────────────────────────

/**
 * List rclone remotes configured on the server.
 */
export async function listRemotes(serverIp: string, username: string): Promise<RemoteEntry[]> {
  const ssh = await connectSSH(serverIp, username);
  try {
    // Get remote names
    const namesResult = await ssh.execCommand('rclone listremotes 2>/dev/null');
    const names = assertCommandSuccess(namesResult, 'rclone listremotes')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    if (names.length === 0) return [];

    // Get types from config dump
    const configResult = await ssh.execCommand('rclone config dump 2>/dev/null');
    let configMap: Record<string, { type?: string }> = {};
    try {
      configMap = JSON.parse(configResult.stdout || '{}');
    } catch { /* config dump may not be available */ }

    return names.map(name => {
      const key = name.replace(/:$/, '');
      return {
        name,
        type: configMap[key]?.type ?? 'unknown',
      };
    });
  } finally {
    ssh.dispose();
  }
}

/**
 * Browse files/folders at a path on an rclone remote.
 */
export async function browseRemote(
  serverIp: string,
  username: string,
  remote: string,
  remotePath: string,
): Promise<RemoteFileEntry[]> {
  const ssh = await connectSSH(serverIp, username);
  try {
    const fullPath = `${remote}${remotePath}`;
    const result = await ssh.execCommand(
      `rclone lsjson --no-modtime=false ${shellQuote(fullPath)} 2>&1`
    );
    const stdout = assertCommandSuccess(result, `rclone lsjson ${fullPath}`);
    const entries: RemoteFileEntry[] = JSON.parse(stdout);
    return entries;
  } finally {
    ssh.dispose();
  }
}

// ── Server file browsing (rsync / local paths) ──────────────────────────────

/**
 * Browse files/folders at a path on the server's local filesystem.
 */
export async function browseServerPath(
  serverIp: string,
  username: string,
  serverPath: string,
): Promise<ServerFileEntry[]> {
  const ssh = await connectSSH(serverIp, username);
  try {
    // Use a simple find + stat to list the directory non-recursively
    const cmd = `python3 -c "
import os, json, sys
p = sys.argv[1]
entries = []
try:
    for name in os.listdir(p):
        full = os.path.join(p, name)
        try:
            s = os.stat(full)
            entries.append({
                'name': name,
                'path': full,
                'size': s.st_size,
                'isDir': os.path.isdir(full),
                'modTime': s.st_mtime,
            })
        except OSError:
            pass
except OSError as e:
    print(json.dumps({'error': str(e)}))
    sys.exit(1)
print(json.dumps(entries))
" ${shellQuote(serverPath)}`;

    const result = await ssh.execCommand(cmd);
    const stdout = assertCommandSuccess(result, `browse ${serverPath}`);
    const parsed = JSON.parse(stdout);
    if (parsed.error) throw new Error(parsed.error);
    return parsed;
  } finally {
    ssh.dispose();
  }
}

// ── Server-to-Server task discovery ──────────────────────────────────────────

/**
 * List RsyncTask instances from the scheduler on the server.
 * Reads env files under /etc/systemd/system/ to extract task parameters.
 */
export async function listS2STasks(
  serverIp: string,
  username: string,
): Promise<S2STask[]> {
  const ssh = await connectSSH(serverIp, username);
  try {
    // Use the scheduler's get-task-instances.py if available, otherwise read env files directly
    const scriptPath = '/opt/45drives/houston/scheduler/scripts/get-task-instances.py';
    const result = await ssh.execCommand(`python3 ${shellQuote(scriptPath)} 2>/dev/null`);

    if (result.code !== 0 || !result.stdout.trim()) {
      // Fallback: read env files directly
      return await readRsyncEnvFiles(ssh);
    }

    const tasks: Array<{
      name: string;
      template: string;
      parameters: Record<string, string>;
    }> = JSON.parse(result.stdout);

    return tasks
      .filter(t => t.template === 'RsyncTask')
      .filter(t => t.parameters['rsyncConfig_target_info_host']) // only tasks with a remote host
      .map(t => ({
        name: t.name,
        localPath: t.parameters['rsyncConfig_local_path'] || '',
        remoteHost: t.parameters['rsyncConfig_target_info_host'] || '',
        remotePort: parseInt(t.parameters['rsyncConfig_target_info_port'] || '22', 10),
        remoteUser: t.parameters['rsyncConfig_target_info_user'] || 'root',
        remotePath: t.parameters['rsyncConfig_target_info_path'] || '',
        direction: (t.parameters['rsyncConfig_direction'] || 'push') as 'push' | 'pull',
      }));
  } finally {
    ssh.dispose();
  }
}

/**
 * List ZfsReplicationTask instances from the scheduler on the server.
 */
export async function listZfsReplicationTasks(
  serverIp: string,
  username: string,
): Promise<ZfsReplicationTaskInfo[]> {
  const ssh = await connectSSH(serverIp, username);
  try {
    const scriptPath = '/opt/45drives/houston/scheduler/scripts/get-task-instances.py';
    const result = await ssh.execCommand(`python3 ${shellQuote(scriptPath)} 2>/dev/null`);

    if (result.code !== 0 || !result.stdout.trim()) return [];

    const tasks: Array<{
      name: string;
      template: string;
      parameters: Record<string, string>;
    }> = JSON.parse(result.stdout);

    const joinZfs = (pool: string, ds: string) =>
      pool && ds ? `${pool}/${ds}` : pool || ds;

    return tasks
      .filter(t => t.template === 'ZfsReplicationTask')
      .map(t => {
        const p = t.parameters;
        return {
          name: t.name,
          sourceDataset: joinZfs(
            p['zfsRepConfig_sourceDataset_pool'] || '',
            p['zfsRepConfig_sourceDataset_dataset'] || ''
          ),
          destDataset: joinZfs(
            p['zfsRepConfig_destDataset_pool'] || '',
            p['zfsRepConfig_destDataset_dataset'] || ''
          ),
          destHost: p['zfsRepConfig_destDataset_host'] || '',
          destUser: p['zfsRepConfig_destDataset_user'] || 'root',
          destSshPort: parseInt(p['zfsRepConfig_destDataset_sshPort'] || '22', 10),
          direction: (p['zfsRepConfig_direction'] || 'push') as 'push' | 'pull',
        };
      });
  } finally {
    ssh.dispose();
  }
}

/** Fallback: directly read env files for RsyncTask in /etc/systemd/system/ */
async function readRsyncEnvFiles(ssh: NodeSSH): Promise<S2STask[]> {
  const result = await ssh.execCommand(
    `ls /etc/systemd/system/houston_scheduler_RsyncTask_*.env 2>/dev/null`
  );
  if (result.code !== 0 || !result.stdout.trim()) return [];

  const envFiles = result.stdout.trim().split('\n').filter(Boolean);
  const tasks: S2STask[] = [];

  for (const envFile of envFiles) {
    const catResult = await ssh.execCommand(`cat ${shellQuote(envFile)}`);
    if (catResult.code !== 0) continue;

    const params: Record<string, string> = {};
    for (const line of catResult.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      params[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
    }

    const host = params['rsyncConfig_target_info_host'];
    if (!host) continue; // skip local-only tasks

    // Extract task name from filename: houston_scheduler_RsyncTask_{name}.env
    const basename = envFile.split('/').pop() || '';
    const nameMatch = basename.match(/^houston_scheduler_RsyncTask_(.+)\.env$/);
    const name = nameMatch ? nameMatch[1] : basename;

    tasks.push({
      name,
      localPath: params['rsyncConfig_local_path'] || '',
      remoteHost: host,
      remotePort: parseInt(params['rsyncConfig_target_info_port'] || '22', 10),
      remoteUser: params['rsyncConfig_target_info_user'] || 'root',
      remotePath: params['rsyncConfig_target_info_path'] || '',
      direction: (params['rsyncConfig_direction'] || 'push') as 'push' | 'pull',
    });
  }

  return tasks;
}

/**
 * Detect replication anchor snapshots for a given dataset.
 *
 * Queries the scheduler's task instances on the server, finds ZFS replication
 * tasks that involve the given dataset, then determines the most recent common
 * snapshot (by GUID) between the local and remote sides. That common snapshot
 * is the "replication anchor" — deleting it forces a full re-send on the next
 * replication run.
 */
export async function getReplicationAnchors(
  serverIp: string,
  username: string,
  dataset: string,
): Promise<ReplicationAnchor[]> {
  const ssh = await connectSSH(serverIp, username);
  try {
    // 1. Get all scheduler task instances
    const scriptPath = '/opt/45drives/houston/scheduler/scripts/get-task-instances.py';
    const taskResult = await ssh.execCommand(`python3 ${shellQuote(scriptPath)} 2>/dev/null`);

    if (taskResult.code !== 0 || !taskResult.stdout.trim()) return [];

    const allTasks: Array<{
      name: string;
      template: string;
      parameters: Record<string, string>;
    }> = JSON.parse(taskResult.stdout);

    // 2. Filter for ZfsReplicationTask instances involving this dataset
    const repTasks = allTasks
      .filter(t => t.template === 'ZfsReplicationTask')
      .map(t => {
        const p = t.parameters;
        const srcPool = p['zfsRepConfig_sourceDataset_pool'] || '';
        const srcDs = p['zfsRepConfig_sourceDataset_dataset'] || '';
        const dstPool = p['zfsRepConfig_destDataset_pool'] || '';
        const dstDs = p['zfsRepConfig_destDataset_dataset'] || '';
        const joinZfs = (pool: string, ds: string) =>
          pool && ds ? `${pool}/${ds}` : pool || ds;
        return {
          name: t.name,
          sourceDataset: joinZfs(srcPool, srcDs),
          destDataset: joinZfs(dstPool, dstDs),
          destHost: p['zfsRepConfig_destDataset_host'] || '',
          destUser: p['zfsRepConfig_destDataset_user'] || 'root',
          destSshPort: parseInt(p['zfsRepConfig_destDataset_sshPort'] || '22', 10),
          direction: (p['zfsRepConfig_direction'] || 'push') as 'push' | 'pull',
        };
      });

    // Push: source is local. Pull: dest is local.
    const matchingTasks = repTasks.filter(t => {
      if (t.direction === 'push') return t.sourceDataset === dataset;
      if (t.direction === 'pull') return t.destDataset === dataset;
      return false;
    });

    if (matchingTasks.length === 0) return [];

    // 3. Get local snapshots with GUIDs
    const localSnapResult = await ssh.execCommand(
      `zfs list -H -p -o name,guid,creation -t snapshot -r ${shellQuote(dataset)} 2>/dev/null`,
    );
    if (localSnapResult.code !== 0 || !localSnapResult.stdout.trim()) return [];

    const localSnaps = localSnapResult.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const parts = line.split('\t');
        return { name: parts[0], guid: parts[1], creation: parseInt(parts[2] || '0', 10) };
      })
      .filter(s => s.name.startsWith(dataset + '@')); // Only direct snapshots of this dataset

    if (localSnaps.length === 0) return [];

    // 4. For each task, get remote snapshots and find the most recent common snapshot
    const anchorMap = new Map<string, { tasks: Array<{ name: string; target: string }> }>();

    for (const task of matchingTasks) {
      let otherDataset: string;
      let otherHost: string;
      let otherUser: string;
      let otherSshPort: number;

      if (task.direction === 'push') {
        // Push: other side is destination
        otherDataset = task.destDataset;
        otherHost = task.destHost;
        otherUser = task.destUser;
        otherSshPort = task.destSshPort;
      } else {
        // Pull: other side is source (on the remote host)
        otherDataset = task.sourceDataset;
        otherHost = task.destHost;
        otherUser = task.destUser;
        otherSshPort = task.destSshPort;
      }

      let remoteSnaps: Array<{ name: string; guid: string; creation: number }> = [];
      try {
        if (otherHost) {
          // SSH hop: managed server → remote host
          const hopCmd = [
            'ssh',
            '-p', String(otherSshPort),
            '-o', 'BatchMode=yes',
            '-o', 'ConnectTimeout=10',
            '-o', 'StrictHostKeyChecking=accept-new',
            `${otherUser}@${otherHost}`,
            'zfs', 'list', '-H', '-p',
            '-o', 'name,guid,creation',
            '-t', 'snapshot',
            '-r', otherDataset,
          ].map(shellQuote).join(' ');
          const result = await ssh.execCommand(`${hopCmd} 2>/dev/null`);
          if (result.code === 0 && result.stdout.trim()) {
            remoteSnaps = result.stdout.trim().split('\n').filter(Boolean).map(line => {
              const parts = line.split('\t');
              return { name: parts[0], guid: parts[1], creation: parseInt(parts[2] || '0', 10) };
            }).filter(s => s.name.startsWith(otherDataset + '@'));
          }
        } else {
          // Local: destination is on the same server
          const result = await ssh.execCommand(
            `zfs list -H -p -o name,guid,creation -t snapshot -r ${shellQuote(otherDataset)} 2>/dev/null`,
          );
          if (result.code === 0 && result.stdout.trim()) {
            remoteSnaps = result.stdout.trim().split('\n').filter(Boolean).map(line => {
              const parts = line.split('\t');
              return { name: parts[0], guid: parts[1], creation: parseInt(parts[2] || '0', 10) };
            }).filter(s => s.name.startsWith(otherDataset + '@'));
          }
        }
      } catch {
        // Can't reach the other side — skip this task
        continue;
      }

      if (remoteSnaps.length === 0) continue;

      // Find most recent common snapshot by GUID
      const remoteGuids = new Set(remoteSnaps.map(s => s.guid));
      const commonSnaps = localSnaps
        .filter(s => remoteGuids.has(s.guid))
        .sort((a, b) => b.creation - a.creation);

      if (commonSnaps.length === 0) continue;

      const anchor = commonSnaps[0];
      const targetDesc = otherHost
        ? `${otherUser}@${otherHost}:${otherDataset}`
        : otherDataset;

      const existing = anchorMap.get(anchor.name);
      if (existing) {
        existing.tasks.push({ name: task.name, target: targetDesc });
      } else {
        anchorMap.set(anchor.name, {
          tasks: [{ name: task.name, target: targetDesc }],
        });
      }
    }

    // 5. Convert to array
    return Array.from(anchorMap.entries()).map(([snapshotName, info]) => {
      const atIdx = snapshotName.indexOf('@');
      return {
        snapshotName,
        snapName: snapshotName.substring(atIdx + 1),
        tasks: info.tasks,
      };
    });
  } catch {
    // If scheduler isn't installed or any parse error, return empty gracefully
    return [];
  } finally {
    ssh.dispose();
  }
}

/**
 * Browse files on the remote server of an S2S task.
 * Hops through the connected server via SSH to reach the remote backup host.
 */
export async function browseS2SRemotePath(
  serverIp: string,
  username: string,
  remoteHost: string,
  remotePort: number,
  remoteUser: string,
  remotePath: string,
): Promise<ServerFileEntry[]> {
  const ssh = await connectSSH(serverIp, username);
  try {
    // Build the SSH hop command: from server -> remote host, list directory
    const sshCmd = [
      'ssh',
      '-p', String(remotePort),
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'StrictHostKeyChecking=accept-new',
      `${remoteUser}@${remoteHost}`,
    ].map(shellQuote).join(' ');

    const listScript = `python3 -c "
import os, json, sys
p = sys.argv[1]
entries = []
try:
    for name in sorted(os.listdir(p)):
        full = os.path.join(p, name)
        try:
            s = os.stat(full)
            entries.append({
                'name': name,
                'path': full,
                'size': s.st_size,
                'isDir': os.path.isdir(full),
                'modTime': s.st_mtime,
            })
        except OSError:
            pass
except OSError as e:
    print(json.dumps({'error': str(e)}))
    sys.exit(1)
print(json.dumps(entries))
" ${shellQuote(remotePath)}`;

    const result = await ssh.execCommand(`${sshCmd} ${shellQuote(listScript)}`);
    const stdout = assertCommandSuccess(result, `browse S2S remote ${remoteHost}:${remotePath}`);
    const parsed = JSON.parse(stdout);
    if (parsed.error) throw new Error(parsed.error);
    return parsed;
  } finally {
    ssh.dispose();
  }
}

// ── Progress parsing helpers ─────────────────────────────────────────────────

/**
 * Parse rsync --info=progress2 output lines.
 * Example: "  1,234,567  45%   12.34MB/s    0:00:03"
 */
function parseRsyncProgress(
  chunk: string,
  opId: string,
  onProgress?: RestoreProgressCallback,
) {
  // rsync --info=progress2 outputs lines like:
  //   1,048,576 100%   10.00MB/s    0:00:00 (xfr#1, to-chk=2/5)
  const match = chunk.match(/[\d,]+\s+(\d+)%\s+[\d.]+\w+\/s\s+[\d:]+/);
  if (match) {
    const pct = parseInt(match[1], 10);
    onProgress?.({
      operationId: opId,
      phase: 'downloading',
      bytesProcessed: pct,
      bytesTotal: 100,
      message: `${pct}% complete`,
    });
  }
}

/**
 * Parse rclone --progress output.
 * Example: "Transferred:   1.234 GBytes / 2.345 GBytes, 53%, 10.000 MBytes/s"
 */
function parseRcloneProgress(
  chunk: string,
  opId: string,
  onProgress?: RestoreProgressCallback,
) {
  const match = chunk.match(/Transferred:\s+[\d.]+\s*\w+\s*\/\s*[\d.]+\s*\w+,\s*(\d+)%/);
  if (match) {
    const pct = parseInt(match[1], 10);
    onProgress?.({
      operationId: opId,
      phase: 'downloading',
      bytesProcessed: pct,
      bytesTotal: 100,
      message: `${pct}% transferred`,
    });
  }
  // Also parse per-file lines: "* filename: 45% done, ..."
  const fileMatch = chunk.match(/\*\s+(.+?):\s+\d+%/);
  if (fileMatch) {
    onProgress?.({
      operationId: opId,
      phase: 'downloading',
      currentFile: fileMatch[1],
    });
  }
}

/**
 * Build rsync file filter args for selected files.
 * Returns an rsync filter string or empty string if no selection (restore all).
 */
function buildRsyncFileFilter(selectedFiles?: string[]): string {
  if (!selectedFiles || selectedFiles.length === 0) return '';
  // Include only selected files, exclude everything else
  const includes = selectedFiles.map(f => `--include=${shellQuote(f)}`).join(' ');
  return `${includes} --exclude='*'`;
}

/**
 * Build rclone filter flags for selected files.
 * Uses --filter instead of --include/--exclude to avoid parse order issues.
 */
function buildRcloneFilterFlags(selectedFiles?: string[]): string {
  if (!selectedFiles || selectedFiles.length === 0) return '';
  const filters = selectedFiles.map(f => `--filter '+ ${f}'`).join(' ');
  return `${filters} --filter '- *'`;
}

// ── Restore operations ───────────────────────────────────────────────────────

/**
 * Find the best staging directory on the server — a ZFS pool mountpoint with
 * the most available space.  Falls back to /tmp if no pools are found.
 *
 * Returns the full staging path (e.g. /tank/.houston-restore-staging/<opId>).
 */
async function pickStagingDir(ssh: NodeSSH, operationId: string): Promise<string> {
  // Try to find a ZFS pool with the most free space
  const result = await ssh.execCommand(
    `zfs list -H -o mountpoint,avail -t filesystem -d 0 2>/dev/null | sort -t$'\\t' -k2 -h | tail -1`,
  );
  const line = result.stdout.trim();
  if (line) {
    const mountpoint = line.split(/\s+/)[0];
    if (mountpoint && mountpoint.startsWith('/')) {
      return `${mountpoint}/.houston-restore-staging/${operationId}`;
    }
  }
  // Fallback to /tmp
  return `/tmp/houston-restore-staging/${operationId}`;
}

/**
 * Restore files from an rclone remote or server path to the server.
 */
export async function restoreToServer(
  serverIp: string,
  username: string,
  source: string,
  sourcePath: string,
  destPath: string,
  onProgress?: RestoreProgressCallback,
  operationId?: string,
  selectedFiles?: string[],
): Promise<RestoreResult> {
  const opId = operationId ?? crypto.randomUUID();
  const ssh = await connectSSH(serverIp, username);

  try {
    onProgress?.({ operationId: opId, phase: 'downloading', message: `Restoring to ${destPath}...` });

    // Ensure destination exists
    await ssh.execCommand(`mkdir -p ${shellQuote(destPath)}`);

    let cmd: string;

    if (source === 'server') {
      const filter = buildRsyncFileFilter(selectedFiles);
      cmd = `rsync -a --info=progress2 ${filter} ${shellQuote(sourcePath + '/')} ${shellQuote(destPath + '/')} 2>&1`;
    } else {
      // Ensure sourcePath has at least a root slash for rclone
      const safePath = sourcePath === '/' ? '' : sourcePath;
      const fullSource = `${source}${safePath}`;
      const filter = buildRcloneFilterFlags(selectedFiles);
      cmd = `rclone copy --progress ${filter} ${shellQuote(fullSource)} ${shellQuote(destPath)} 2>&1`;
    }

    const result = await ssh.execCommand(cmd, {
      onStdout: (chunk) => {
        const text = chunk.toString();
        if (source === 'server') {
          parseRsyncProgress(text, opId, onProgress);
        } else {
          parseRcloneProgress(text, opId, onProgress);
        }
      },
    });

    if (result.code !== 0 && result.code !== null) {
      const error = (result.stderr || result.stdout || '').trim();
      onProgress?.({ operationId: opId, phase: 'error', error });
      return { success: false, error };
    }

    onProgress?.({ operationId: opId, phase: 'complete', message: 'Restore complete' });
    return { success: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    onProgress?.({ operationId: opId, phase: 'error', error });
    return { success: false, error };
  } finally {
    ssh.dispose();
  }
}

/**
 * Stage files from an rclone remote or server path to a temp dir on the server,
 * then pull them to the client via rsync (Mac/Linux) or robocopy (Windows).
 */
export async function restoreToClient(
  serverIp: string,
  username: string,
  source: string,
  sourcePath: string,
  localDestPath: string,
  onProgress?: RestoreProgressCallback,
  operationId?: string,
  selectedFiles?: string[],
): Promise<RestoreResult> {
  const opId = operationId ?? crypto.randomUUID();
  const ssh = await connectSSH(serverIp, username);

  let stagingDir = '';
  try {
    stagingDir = await pickStagingDir(ssh, opId);

    // Stage 1: Copy files to server staging dir
    await ssh.execCommand(`mkdir -p ${shellQuote(stagingDir)}`);
    onProgress?.({ operationId: opId, phase: 'staging', message: `Staging files on server...` });

    let cmd: string;
    if (source === 'server') {
      const filter = buildRsyncFileFilter(selectedFiles);
      cmd = `rsync -a --info=progress2 ${filter} ${shellQuote(sourcePath + '/')} ${shellQuote(stagingDir + '/')} 2>&1`;
    } else {
      const safePath = sourcePath === '/' ? '' : sourcePath;
      const fullSource = `${source}${safePath}`;
      const filter = buildRcloneFilterFlags(selectedFiles);
      cmd = `rclone copy --progress ${filter} ${shellQuote(fullSource)} ${shellQuote(stagingDir)} 2>&1`;
    }

    const stageResult = await ssh.execCommand(cmd, {
      onStdout: (chunk) => {
        const text = chunk.toString();
        if (source === 'server') {
          parseRsyncProgress(text, opId, onProgress);
        } else {
          parseRcloneProgress(text, opId, onProgress);
        }
      },
    });

    if (stageResult.code !== 0 && stageResult.code !== null) {
      const error = (stageResult.stderr || stageResult.stdout || '').trim();
      onProgress?.({ operationId: opId, phase: 'error', error });
      return { success: false, error };
    }

    // Stage 2: Pull from server to client
    onProgress?.({ operationId: opId, phase: 'downloading', message: `Downloading to ${localDestPath}...` });
    const dlResult = await downloadFromServer(serverIp, username, stagingDir, localDestPath, opId, onProgress);
    if (!dlResult.success) return dlResult;

    onProgress?.({ operationId: opId, phase: 'complete', message: 'Restore complete' });
    return { success: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    onProgress?.({ operationId: opId, phase: 'error', error });
    return { success: false, error };
  } finally {
    // Cleanup staging dir
    if (stagingDir) await ssh.execCommand(`rm -rf ${shellQuote(stagingDir)}`).catch(() => {});
    ssh.dispose();
  }
}

// ── S2S restore operations ───────────────────────────────────────────────────

/**
 * Restore files from an S2S (server-to-server) remote via rsync over SSH hop.
 * Connects to the houston server, then uses rsync with SSH to pull from the remote host.
 */
export async function restoreFromS2S(
  serverIp: string,
  username: string,
  remoteHost: string,
  remotePort: number,
  remoteUser: string,
  sourcePath: string,
  destPath: string,
  onProgress?: RestoreProgressCallback,
  operationId?: string,
  selectedFiles?: string[],
): Promise<RestoreResult> {
  const opId = operationId ?? crypto.randomUUID();
  const safeRemoteHost = assertSafeHost(remoteHost);
  const safeRemoteUser = assertSafeUsername(remoteUser);
  const ssh = await connectSSH(serverIp, username);

  try {
    onProgress?.({ operationId: opId, phase: 'downloading', message: `Restoring from ${safeRemoteUser}@${safeRemoteHost}:${sourcePath} to ${destPath}...` });

    // Ensure destination exists
    await ssh.execCommand(`mkdir -p ${shellQuote(destPath)}`);

    // rsync from remote host via SSH hop
    const sshCmd = `ssh -p ${String(remotePort)} -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new`;
    const sourceSpec = `${safeRemoteUser}@${safeRemoteHost}:${sourcePath}${sourcePath.endsWith('/') ? '' : '/'}`;
    const filter = buildRsyncFileFilter(selectedFiles);

    const result = await ssh.execCommand(
      `rsync -a --info=progress2 ${filter} -e ${shellQuote(sshCmd)} ${shellQuote(sourceSpec)} ${shellQuote(destPath + '/')} 2>&1`,
      {
        onStdout: (chunk) => parseRsyncProgress(chunk.toString(), opId, onProgress),
      },
    );

    if (result.code !== 0 && result.code !== null) {
      const error = (result.stderr || result.stdout || '').trim();
      onProgress?.({ operationId: opId, phase: 'error', error });
      return { success: false, error };
    }

    onProgress?.({ operationId: opId, phase: 'complete', message: 'Restore complete' });
    return { success: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    onProgress?.({ operationId: opId, phase: 'error', error });
    return { success: false, error };
  } finally {
    ssh.dispose();
  }
}

/**
 * Restore S2S files to the client: stage on server via SSH hop, then pull to client.
 */
export async function restoreS2SToClient(
  serverIp: string,
  username: string,
  remoteHost: string,
  remotePort: number,
  remoteUser: string,
  sourcePath: string,
  localDestPath: string,
  onProgress?: RestoreProgressCallback,
  operationId?: string,
  selectedFiles?: string[],
): Promise<RestoreResult> {
  const opId = operationId ?? crypto.randomUUID();
  const safeRemoteHost = assertSafeHost(remoteHost);
  const safeRemoteUser = assertSafeUsername(remoteUser);
  const ssh = await connectSSH(serverIp, username);

  let stagingDir = '';
  try {
    stagingDir = await pickStagingDir(ssh, opId);

    // Stage 1: rsync from remote host to server staging dir
    await ssh.execCommand(`mkdir -p ${shellQuote(stagingDir)}`);
    onProgress?.({ operationId: opId, phase: 'staging', message: `Staging files from ${safeRemoteUser}@${safeRemoteHost}:${sourcePath}...` });

    const sshCmd = `ssh -p ${String(remotePort)} -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new`;
    const sourceSpec = `${safeRemoteUser}@${safeRemoteHost}:${sourcePath}${sourcePath.endsWith('/') ? '' : '/'}`;
    const filter = buildRsyncFileFilter(selectedFiles);

    const stageResult = await ssh.execCommand(
      `rsync -a --info=progress2 ${filter} -e ${shellQuote(sshCmd)} ${shellQuote(sourceSpec)} ${shellQuote(stagingDir + '/')} 2>&1`,
      {
        onStdout: (chunk) => parseRsyncProgress(chunk.toString(), opId, onProgress),
      },
    );

    if (stageResult.code !== 0 && stageResult.code !== null) {
      const error = (stageResult.stderr || stageResult.stdout || '').trim();
      onProgress?.({ operationId: opId, phase: 'error', error });
      return { success: false, error };
    }

    // Stage 2: Pull from server to client
    onProgress?.({ operationId: opId, phase: 'downloading', message: `Downloading to ${localDestPath}...` });
    const dlResult = await downloadFromServer(serverIp, username, stagingDir, localDestPath, opId, onProgress);
    if (!dlResult.success) return dlResult;

    onProgress?.({ operationId: opId, phase: 'complete', message: 'Restore complete' });
    return { success: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    onProgress?.({ operationId: opId, phase: 'error', error });
    return { success: false, error };
  } finally {
    // Cleanup staging dir
    if (stagingDir) await ssh.execCommand(`rm -rf ${shellQuote(stagingDir)}`).catch(() => {});
    ssh.dispose();
  }
}

// ── Client download helper ───────────────────────────────────────────────────

/**
 * Download files from a server path to a local directory.
 * Uses rsync over SSH on Mac/Linux, robocopy over UNC on Windows.
 */
async function downloadFromServer(
  serverIp: string,
  username: string,
  serverPath: string,
  localDestPath: string,
  operationId: string,
  onProgress?: RestoreProgressCallback,
): Promise<RestoreResult> {
  const safeHost = assertSafeHost(serverIp);
  const safeUser = assertSafeUsername(username);

  // Ensure local destination exists
  await fs.promises.mkdir(localDestPath, { recursive: true });

  if (process.platform === 'win32') {
    return downloadViaRobocopy(safeHost, safeUser, serverPath, localDestPath, operationId, onProgress);
  } else {
    return downloadViaRsync(safeHost, safeUser, serverPath, localDestPath, operationId, onProgress);
  }
}

/**
 * rsync pull: local rsync -> server via SSH key
 */
function downloadViaRsync(
  host: string,
  username: string,
  serverPath: string,
  localDestPath: string,
  operationId: string,
  onProgress?: RestoreProgressCallback,
): Promise<RestoreResult> {
  return new Promise((resolve) => {
    const keyDir = getKeyDir();
    const privateKeyPath = path.join(keyDir, 'id_rsa');
    const sshCmd = `ssh -i ${privateKeyPath} -o StrictHostKeyChecking=accept-new -o BatchMode=yes`;
    const source = `${username}@${host}:${serverPath}/`;
    const dest = localDestPath.endsWith('/') ? localDestPath : `${localDestPath}/`;

    const proc = spawn('rsync', [
      '-a', '--info=progress2',
      '-e', sshCmd,
      source,
      dest,
    ]);

    proc.stdout.on('data', (chunk: Buffer) => {
      parseRsyncProgress(chunk.toString(), operationId, onProgress);
    });

    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: stderr.trim() || `rsync exited with code ${code}` });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: `Failed to start rsync: ${err.message}` });
    });
  });
}

/**
 * Windows download: mount SMB share via net use, robocopy from staged path, then unmount.
 *
 * Flow:
 *   1. Look up SMB credentials from the credential vault for this server
 *   2. Use existing mount_smb.bat to map a drive letter
 *   3. robocopy from mapped_drive:\staging_path → localDestPath
 *   4. net use /delete to unmount
 */
function downloadViaRobocopy(
  host: string,
  _username: string,
  serverPath: string,
  localDestPath: string,
  operationId: string,
  onProgress?: RestoreProgressCallback,
): Promise<RestoreResult> {
  return new Promise(async (resolve) => {
    let driveLetter: string | null = null;

    try {
      // Find an SMB credential for this server
      const creds = getCredentialManager().listForHost(host);
      if (creds.length === 0) {
        resolve({ success: false, error: `No SMB credentials found for ${host}. Set up a backup task first to store credentials.` });
        return;
      }

      // Use the first share's credentials
      const credEntry = creds[0];
      const credential = getCredentialManager().findByHostAndShare(host, credEntry.share);
      if (!credential) {
        resolve({ success: false, error: `Could not decrypt SMB credentials for ${host}\\${credEntry.share}` });
        return;
      }

      onProgress?.({ operationId, phase: 'downloading', message: `Mounting \\\\${host}\\${credential.share}...` });

      // Write temp credential file
      const tmpCredFile = path.join(os.tmpdir(), `houston-restore-${operationId}.cred`);
      fs.writeFileSync(tmpCredFile, `username=${credential.username}\npassword=${credential.password}\n`, { mode: 0o600 });

      try {
        // Run mount_smb.bat to get a drive letter
        const mountBat = getMountSmbScript();
        const mountOutput = execSync(
          `"${mountBat}" "${host}" "${credential.share}" "${tmpCredFile}"`,
          { encoding: 'utf8', timeout: 30000 },
        );

        // Parse JSON response for DriveLetter
        const driveMatch = mountOutput.match(/"DriveLetter"\s*:\s*"([A-Z])"/i);
        if (!driveMatch) {
          resolve({ success: false, error: `Failed to mount SMB share: ${mountOutput.trim()}` });
          return;
        }
        driveLetter = driveMatch[1];

        // The staging dir on the server is at serverPath (e.g. /tmp/houston-restore-staging/uuid)
        // On the SMB share it appears as drive_letter:\tmp\houston-restore-staging\uuid
        // But the staging dir is NOT on the SMB share — it's on /tmp.
        // We need to first move files from /tmp staging to the SMB share, then robocopy locally.

        // Actually: the server staging dir is at /tmp, which isn't on the SMB share.
        // We need the server to move files from /tmp to the SMB share first.
        // Let's rsync server-side: /tmp/staging → SMB share staging area, then robocopy from mounted share.

        const ssh = await connectSSH(host, credential.username);
        const smbMountPath = credential.share; // The share name on the server
        try {
          // Find where the SMB share is mounted on the server
          const mountResult = await ssh.execCommand(
            `net usershare info ${shellQuote(smbMountPath)} 2>/dev/null | head -2 | tail -1 || smbstatus --shares 2>/dev/null | grep -i ${shellQuote(smbMountPath)} | awk '{print $2}'`,
          );

          // Alternative: try to find it via testparm
          const sharePathResult = await ssh.execCommand(
            `testparm -s 2>/dev/null | grep -A5 "\\[${smbMountPath}\\]" | grep "path" | awk '{print $3}'`,
          );

          let shareMountPath = sharePathResult.stdout.trim();
          if (!shareMountPath) {
            // Try net usershare
            const netResult = await ssh.execCommand(
              `net usershare info ${shellQuote(smbMountPath)} 2>/dev/null | grep "^path=" | cut -d= -f2`,
            );
            shareMountPath = netResult.stdout.trim();
          }

          if (!shareMountPath) {
            resolve({ success: false, error: `Could not determine mount path for SMB share "${smbMountPath}" on ${host}` });
            return;
          }

          // Copy from /tmp staging to the SMB share on the server
          const smbStagingDir = `${shareMountPath}/.houston-restore-staging/${operationId}`;
          await ssh.execCommand(`mkdir -p ${shellQuote(smbStagingDir)}`);
          const copyResult = await ssh.execCommand(
            `rsync -a ${shellQuote(serverPath + '/')} ${shellQuote(smbStagingDir + '/')} 2>&1`,
          );
          if (copyResult.code !== 0 && copyResult.code !== null) {
            resolve({ success: false, error: `Failed to copy to SMB staging: ${(copyResult.stderr || copyResult.stdout || '').trim()}` });
            return;
          }

          // Now robocopy from the mapped drive to local dest
          onProgress?.({ operationId, phase: 'downloading', message: `Copying files to ${localDestPath}...` });
          const rcSource = `${driveLetter}:\\.houston-restore-staging\\${operationId}`;

          const rc = await new Promise<RestoreResult>((rcResolve) => {
            const proc = spawn('robocopy', [
              rcSource, localDestPath,
              '/E', '/Z', '/FFT', '/R:2', '/W:5', '/MT:8', '/NJH', '/bytes',
            ], { shell: true });

            let output = '';
            proc.stdout.on('data', (chunk: Buffer) => {
              const text = chunk.toString();
              output += text;
              // Parse robocopy progress (bytes count lines)
              const pctMatch = text.match(/(\d+(?:\.\d+)?)%/);
              if (pctMatch) {
                onProgress?.({ operationId, phase: 'downloading', message: `${pctMatch[1]}% copied` });
              }
            });

            let stderr = '';
            proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

            proc.on('close', (code) => {
              // robocopy: 0-7 = success, 8+ = error
              if (code !== null && code < 8) {
                rcResolve({ success: true });
              } else {
                rcResolve({ success: false, error: stderr.trim() || `robocopy exited with code ${code}` });
              }
            });

            proc.on('error', (err) => {
              rcResolve({ success: false, error: `Failed to start robocopy: ${err.message}` });
            });
          });

          // Clean up server-side SMB staging
          await ssh.execCommand(`rm -rf ${shellQuote(smbStagingDir)}`).catch(() => {});

          resolve(rc);
        } finally {
          ssh.dispose();
        }
      } finally {
        // Clean up temp cred file
        try { fs.unlinkSync(tmpCredFile); } catch {}
        // Unmount drive
        if (driveLetter) {
          try { execSync(`net use ${driveLetter}: /delete /y`, { timeout: 10000 }); } catch {}
        }
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      resolve({ success: false, error: `Windows download failed: ${error}` });
    }
  });
}

// ── Directory / dataset creation ─────────────────────────────────────────────

/**
 * Create a directory on the server.
 */
export async function createServerDirectory(
  serverIp: string,
  username: string,
  dirPath: string,
): Promise<{ success: boolean; error?: string }> {
  const ssh = await connectSSH(serverIp, username);
  try {
    const result = await ssh.execCommand(`mkdir -p ${shellQuote(dirPath)} 2>&1`);
    if (result.code !== 0 && result.code !== null) {
      return { success: false, error: (result.stderr || result.stdout || '').trim() };
    }
    return { success: true };
  } finally {
    ssh.dispose();
  }
}

/**
 * Create a ZFS dataset on the server.
 */
export async function createZfsDatasetOnServer(
  serverIp: string,
  username: string,
  datasetName: string,
  mountpoint?: string,
): Promise<{ success: boolean; error?: string }> {
  const ssh = await connectSSH(serverIp, username);
  try {
    if (!/^[A-Za-z0-9_./-]+$/.test(datasetName)) {
      return { success: false, error: 'Dataset name contains invalid characters' };
    }

    let cmd = `sudo zfs create`;
    if (mountpoint) {
      cmd += ` -o mountpoint=${shellQuote(mountpoint)}`;
    }
    cmd += ` ${shellQuote(datasetName)} 2>&1`;

    const result = await ssh.execCommand(cmd);
    if (result.code !== 0 && result.code !== null) {
      return { success: false, error: (result.stderr || result.stdout || '').trim() };
    }
    return { success: true };
  } finally {
    ssh.dispose();
  }
}

// ── Snapshot operations ──────────────────────────────────────────────────────

/**
 * List ZFS datasets on a server.
 */
export async function listZfsDatasets(
  serverIp: string,
  username: string,
  password?: string,
): Promise<ZfsDataset[]> {
  const ssh = await connectSSH(serverIp, username, password);
  try {
    const result = await ssh.execCommand(
      'zfs list -H -o name,mountpoint,used,available,usedbyrefreservation -t filesystem 2>/dev/null'
    );
    const stdout = assertCommandSuccess(result, 'zfs list');
    return stdout
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, mountpoint, used, available, usedbyrefreservation] = line.split('\t');
        return { name, mountpoint, used, available, usedbyrefreservation };
      });
  } finally {
    ssh.dispose();
  }
}

/**
 * List ZFS snapshots for a dataset (or all datasets if none specified).
 */
export async function listZfsSnapshots(
  serverIp: string,
  username: string,
  dataset?: string,
): Promise<ZfsSnapshot[]> {
  const ssh = await connectSSH(serverIp, username);
  try {
    const target = dataset ? shellQuote(dataset) : '';
    const result = await ssh.execCommand(
      `zfs list -H -o name,creation,used,referenced -t snapshot ${target} 2>/dev/null`
    );
    const stdout = assertCommandSuccess(result, 'zfs list snapshots');
    return stdout
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, creation, used, referenced] = line.split('\t');
        const atIdx = name.indexOf('@');
        return {
          name,
          dataset: name.substring(0, atIdx),
          snapName: name.substring(atIdx + 1),
          creation,
          used,
          referenced,
        };
      });
  } finally {
    ssh.dispose();
  }
}

/**
 * Rollback a ZFS dataset to a snapshot.
 * This is destructive — it destroys all data created after the snapshot.
 */
export async function rollbackSnapshot(
  serverIp: string,
  username: string,
  snapshotName: string,
): Promise<SnapshotRollbackResult> {
  const ssh = await connectSSH(serverIp, username);
  try {
    const atIdx = snapshotName.indexOf('@');
    if (atIdx === -1) {
      return { success: false, dataset: '', snapshot: snapshotName, error: 'Invalid snapshot name — expected dataset@snapname format' };
    }
    const dataset = snapshotName.substring(0, atIdx);
    const snapName = snapshotName.substring(atIdx + 1);

    // -r forces rollback even if more recent snapshots exist
    const result = await ssh.execCommand(
      `sudo zfs rollback -r ${shellQuote(snapshotName)} 2>&1`
    );

    if (result.code !== 0 && result.code !== null) {
      const error = (result.stderr || result.stdout || '').trim();
      return { success: false, dataset, snapshot: snapName, error };
    }

    return { success: true, dataset, snapshot: snapName };
  } finally {
    ssh.dispose();
  }
}

/**
 * Create a new ZFS snapshot.
 * Safety: checks for active ZFS send/receive operations on the dataset
 * to avoid interrupting in-progress replications.
 */
export async function createZfsSnapshot(
  serverIp: string,
  username: string,
  dataset: string,
  snapName: string,
  recursive: boolean = false,
): Promise<SnapshotCreateResult> {
  const ssh = await connectSSH(serverIp, username);
  try {
    // Validate snapshot name: alphanumeric, dots, underscores, hyphens, colons only
    if (!/^[A-Za-z0-9._:-]+$/.test(snapName)) {
      return { success: false, error: 'Snapshot name may only contain alphanumeric characters, dots, underscores, hyphens, and colons' };
    }
    if (snapName.length > 255) {
      return { success: false, error: 'Snapshot name is too long (max 255 characters)' };
    }

    // Safety: check for active ZFS send/receive on this dataset
    const busyCheck = await ssh.execCommand(
      `zfs list -H -o name,receive_resume_token ${shellQuote(dataset)} 2>/dev/null`
    );
    if (busyCheck.code === 0) {
      const token = busyCheck.stdout.split('\t')[1]?.trim();
      if (token && token !== '-') {
        return { success: false, error: 'Dataset has an active receive-resume token — a replication may be in progress. Please wait and try again.' };
      }
    }

    // Also check if zfs send is running against this dataset
    const sendCheck = await ssh.execCommand(
      `ps aux 2>/dev/null | grep -E 'zfs (send|recv)' | grep -v grep | grep ${shellQuote(dataset)} || true`
    );
    if (sendCheck.stdout.trim()) {
      return { success: false, error: 'A ZFS send/receive operation is currently running on this dataset. Please wait for it to complete before creating a new snapshot.' };
    }

    const fullName = `${dataset}@${snapName}`;
    const flags = recursive ? '-r' : '';
    const result = await ssh.execCommand(
      `sudo zfs snapshot ${flags} ${shellQuote(fullName)} 2>&1`
    );

    if (result.code !== 0 && result.code !== null) {
      const error = (result.stderr || result.stdout || '').trim();
      return { success: false, error };
    }

    return { success: true, snapshotName: fullName };
  } finally {
    ssh.dispose();
  }
}

/**
 * Destroy a ZFS snapshot.
 */
export async function destroyZfsSnapshot(
  serverIp: string,
  username: string,
  snapshotName: string,
  recursive: boolean = false,
): Promise<SnapshotDestroyResult> {
  const ssh = await connectSSH(serverIp, username);
  try {
    const atIdx = snapshotName.indexOf('@');
    if (atIdx === -1) {
      return { success: false, error: 'Invalid snapshot name — expected dataset@snapname format' };
    }

    const flags = recursive ? '-r' : '';
    const result = await ssh.execCommand(
      `sudo zfs destroy ${flags} ${shellQuote(snapshotName)} 2>&1`
    );

    if (result.code !== 0 && result.code !== null) {
      const error = (result.stderr || result.stdout || '').trim();
      return { success: false, error };
    }

    return { success: true };
  } finally {
    ssh.dispose();
  }
}

/**
 * Browse files inside a ZFS snapshot via its .zfs/snapshot/<name>/ path.
 */
export async function browseSnapshotFiles(
  serverIp: string,
  username: string,
  dataset: string,
  snapName: string,
  subPath: string = '/',
): Promise<SnapshotFileEntry[]> {
  const ssh = await connectSSH(serverIp, username);
  try {
    // Get the mountpoint for this dataset
    const mpResult = await ssh.execCommand(
      `zfs get -H -o value mountpoint ${shellQuote(dataset)} 2>/dev/null`
    );
    const mountpoint = assertCommandSuccess(mpResult, 'get mountpoint').trim();
    if (!mountpoint || mountpoint === 'none' || mountpoint === 'legacy') {
      throw new Error(`Dataset ${dataset} has no usable mountpoint (${mountpoint})`);
    }

    // Build path: <mountpoint>/.zfs/snapshot/<snapName>/<subPath>
    const safeSub = subPath.replace(/\.\./g, '').replace(/^\/+/, '');
    const browsePath = `${mountpoint}/.zfs/snapshot/${snapName}${safeSub ? '/' + safeSub : ''}`;

    const cmd = `python3 -c "
import os, json, sys
p = sys.argv[1]
entries = []
try:
    for name in sorted(os.listdir(p)):
        full = os.path.join(p, name)
        try:
            s = os.stat(full)
            entries.append({
                'name': name,
                'path': full,
                'size': s.st_size,
                'isDir': os.path.isdir(full),
                'modTime': s.st_mtime,
            })
        except OSError:
            pass
except OSError as e:
    print(json.dumps({'error': str(e)}))
    sys.exit(1)
print(json.dumps(entries))
" ${shellQuote(browsePath)}`;

    const result = await ssh.execCommand(cmd);
    const stdout = assertCommandSuccess(result, `browse snapshot ${browsePath}`);
    const parsed = JSON.parse(stdout);
    if (parsed.error) throw new Error(parsed.error);
    return parsed;
  } finally {
    ssh.dispose();
  }
}

/**
 * Restore specific files from a ZFS snapshot to a target path on the server.
 */
export async function restoreFromSnapshot(
  serverIp: string,
  username: string,
  dataset: string,
  snapName: string,
  filePaths: string[],
  destPath: string,
): Promise<SnapshotRestoreResult> {
  const ssh = await connectSSH(serverIp, username);
  try {
    if (filePaths.length === 0) {
      return { success: false, error: 'No files selected for restore' };
    }

    // Get the mountpoint for this dataset
    const mpResult = await ssh.execCommand(
      `zfs get -H -o value mountpoint ${shellQuote(dataset)} 2>/dev/null`
    );
    const mountpoint = assertCommandSuccess(mpResult, 'get mountpoint').trim();
    if (!mountpoint || mountpoint === 'none' || mountpoint === 'legacy') {
      throw new Error(`Dataset ${dataset} has no usable mountpoint (${mountpoint})`);
    }

    const snapRoot = `${mountpoint}/.zfs/snapshot/${snapName}`;

    // Ensure destination exists
    await ssh.execCommand(`sudo mkdir -p ${shellQuote(destPath)}`);

    // Use rsync to copy selected files, preserving relative paths
    // Build a file list for rsync --files-from
    const relPaths = filePaths.map(fp => {
      // Convert absolute snapshot paths to relative paths from snapRoot
      if (fp.startsWith(snapRoot)) {
        return fp.substring(snapRoot.length).replace(/^\//, '');
      }
      return fp.replace(/^\//, '');
    });

    // Write file list to a temp file on the server
    const tmpFile = `/tmp/houston-snap-restore-${Date.now()}`;
    const fileListContent = relPaths.join('\n');
    await ssh.execCommand(`cat > ${shellQuote(tmpFile)} << 'HOUSTON_EOF'\n${fileListContent}\nHOUSTON_EOF`);

    const result = await ssh.execCommand(
      `sudo rsync -a --files-from=${shellQuote(tmpFile)} ${shellQuote(snapRoot + '/')} ${shellQuote(destPath + '/')} 2>&1`
    );

    // Clean up temp file
    await ssh.execCommand(`rm -f ${shellQuote(tmpFile)}`);

    if (result.code !== 0 && result.code !== null) {
      const error = (result.stderr || result.stdout || '').trim();
      return { success: false, error };
    }

    return { success: true, filesRestored: relPaths.length };
  } finally {
    ssh.dispose();
  }
}

/**
 * Cancel a running restore operation (best-effort).
 * Kills any rclone/rsync process matching the operation ID on the server.
 */
export async function cancelRestore(
  serverIp: string,
  username: string,
  operationId: string,
): Promise<boolean> {
  const ssh = await connectSSH(serverIp, username);
  try {
    // Kill any rclone/rsync processes that have the staging dir in their args
    await ssh.execCommand(
      `pkill -f ${shellQuote(operationId)} 2>/dev/null || true`
    );
    return true;
  } catch {
    return false;
  } finally {
    ssh.dispose();
  }
}
