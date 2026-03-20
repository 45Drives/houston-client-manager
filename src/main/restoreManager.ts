import { NodeSSH, SSHExecCommandResponse } from 'node-ssh';
import path from 'path';
import fs from 'fs';
import { checkSSH } from './setupSsh';
import { getAgentSocket, getKeyDir, ensureKeyPair } from './crossPlatformSsh';
import { assertSafeHost, assertSafeUsername, shellQuote } from './security';
import { loadSettings } from './settingsStore';

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

async function connectSSH(host: string, username: string): Promise<NodeSSH> {
  const safeHost = assertSafeHost(host);
  const safeUser = assertSafeUsername(username);

  const ssh = new NodeSSH();
  const keyDir = getKeyDir();
  const privateKeyPath = path.join(keyDir, 'id_rsa');
  const publicKeyPath = `${privateKeyPath}.pub`;
  await ensureKeyPair(privateKeyPath, publicKeyPath);

  const agentSock = getAgentSocket();

  try {
    await ssh.connect({
      host: safeHost,
      username: safeUser,
      ...(agentSock
        ? { agent: agentSock }
        : { privateKey: fs.readFileSync(privateKeyPath, 'utf8') }),
      readyTimeout: loadSettings().sshTimeoutMs,
    });
  } catch {
    // If agent fails, fall back to key file
    if (agentSock) {
      await ssh.connect({
        host: safeHost,
        username: safeUser,
        privateKey: fs.readFileSync(privateKeyPath, 'utf8'),
        readyTimeout: loadSettings().sshTimeoutMs,
      });
    } else {
      throw new Error(`SSH connection to ${safeHost} failed`);
    }
  }

  return ssh;
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

// ── Restore operations ───────────────────────────────────────────────────────

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
): Promise<RestoreResult> {
  const opId = operationId ?? crypto.randomUUID();
  const ssh = await connectSSH(serverIp, username);

  try {
    onProgress?.({ operationId: opId, phase: 'downloading', message: `Restoring to ${destPath}...` });

    // Ensure destination exists
    await ssh.execCommand(`mkdir -p ${shellQuote(destPath)}`);

    let result: SSHExecCommandResponse;

    if (source === 'server') {
      // Server-local restore via rsync
      result = await ssh.execCommand(
        `rsync -a --info=progress2 ${shellQuote(sourcePath)} ${shellQuote(destPath)} 2>&1`
      );
    } else {
      // rclone copy from remote
      const fullSource = `${source}${sourcePath}`;
      result = await ssh.execCommand(
        `rclone copy --progress ${shellQuote(fullSource)} ${shellQuote(destPath)} 2>&1`
      );
    }

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
 * Stage files from an rclone remote or server path to an SMB share,
 * so the client can pull them via the existing SMB restore pipeline.
 */
export async function stageForClientRestore(
  serverIp: string,
  username: string,
  source: string,
  sourcePath: string,
  smbSharePath: string,
  onProgress?: RestoreProgressCallback,
  operationId?: string,
): Promise<RestoreResult> {
  const opId = operationId ?? crypto.randomUUID();
  const ssh = await connectSSH(serverIp, username);

  try {
    // Create a staging directory on the SMB share
    const stagingDir = `${smbSharePath}/.houston-restore-staging/${opId}`;
    await ssh.execCommand(`mkdir -p ${shellQuote(stagingDir)}`);

    onProgress?.({ operationId: opId, phase: 'staging', message: `Staging files to ${stagingDir}...` });

    let result: SSHExecCommandResponse;

    if (source === 'server') {
      result = await ssh.execCommand(
        `rsync -a --info=progress2 ${shellQuote(sourcePath)} ${shellQuote(stagingDir)} 2>&1`
      );
    } else {
      const fullSource = `${source}${sourcePath}`;
      result = await ssh.execCommand(
        `rclone copy --progress ${shellQuote(fullSource)} ${shellQuote(stagingDir)} 2>&1`
      );
    }

    if (result.code !== 0 && result.code !== null) {
      const error = (result.stderr || result.stdout || '').trim();
      onProgress?.({ operationId: opId, phase: 'error', error });
      return { success: false, error };
    }

    onProgress?.({ operationId: opId, phase: 'complete', message: 'Files staged for client download' });
    return { success: true, stagedPath: stagingDir };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    onProgress?.({ operationId: opId, phase: 'error', error });
    return { success: false, error };
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
): Promise<ZfsDataset[]> {
  const ssh = await connectSSH(serverIp, username);
  try {
    const result = await ssh.execCommand(
      'zfs list -H -o name,mountpoint,used,available -t filesystem 2>/dev/null'
    );
    const stdout = assertCommandSuccess(result, 'zfs list');
    return stdout
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, mountpoint, used, available] = line.split('\t');
        return { name, mountpoint, used, available };
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
