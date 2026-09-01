/**
 * TopologyProbe — Collects backup relationships from a server in one SSH session.
 *
 * Scheduler tasks only exist as systemd unit env files on each server, so the
 * client discovers them by probing and then caches the result locally.
 */

import { NodeSSH } from 'node-ssh';
import { acquireSSH } from './sshPool';
import { getCredentialManager } from './credentialManager';
import { assertSafeHost, assertSafeUsername, shellQuote } from './security';
import { logEvent } from './logging';

export interface RemoteRsyncTask {
  name: string;
  localPath: string;
  remoteHost: string;
  remotePort: number;
  remoteUser: string;
  remotePath: string;
  direction: 'push' | 'pull';
}

export interface RemoteReplicationTask {
  name: string;
  sourceDataset: string;
  destDataset: string;
  destHost: string;
  destUser: string;
  destSshPort: number;
  direction: 'push' | 'pull';
}

export interface CloudSyncTask {
  name: string;
  localPath: string;
  targetPath: string;
  remote: string;
  provider: string;
  direction: string;
}

export interface CloudRemote {
  name: string;
  type: string;
}

export interface ServerIdentity {
  hostname: string;
  fqdn: string;
  machineId: string;
  addresses: string[];
  /** Directly-attached IPv4 subnets, excluding VPN interfaces. */
  lanSubnets: string[];
}

export interface ServerTopologyProbe {
  host: string;
  probedAt: number;
  reachable: boolean;
  error?: string;
  identity?: ServerIdentity;
  rsyncTasks: RemoteRsyncTask[];
  replicationTasks: RemoteReplicationTask[];
  cloudSyncTasks: CloudSyncTask[];
  cloudRemotes: CloudRemote[];
}

const SCHEDULER_TASK_SCRIPT = '/opt/45drives/houston/scheduler/scripts/get-task-instances.py';
const ENV_FILE_DELIMITER = '===HOUSTON-TASK-FILE===';

type RawTask = { name: string; template: string; parameters: Record<string, string> };

function joinZfs(pool: string, dataset: string): string {
  if (pool && dataset) return `${pool}/${dataset}`;
  return pool || dataset;
}

function parseEnvBody(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    params[key] = value;
  }
  return params;
}

/** Fallback when get-task-instances.py is unavailable: read every scheduler env file at once. */
async function readTasksFromEnvFiles(ssh: NodeSSH): Promise<RawTask[]> {
  const cmd = `for f in /etc/systemd/system/houston_scheduler_*.env; do [ -e "$f" ] || continue; echo "${ENV_FILE_DELIMITER}$f"; cat "$f"; done 2>/dev/null`;
  const result = await ssh.execCommand(cmd);
  if (!result.stdout.trim()) return [];

  const tasks: RawTask[] = [];
  const chunks = result.stdout.split(ENV_FILE_DELIMITER).filter(c => c.trim());

  for (const chunk of chunks) {
    const newlineIdx = chunk.indexOf('\n');
    if (newlineIdx === -1) continue;
    const filePath = chunk.substring(0, newlineIdx).trim();
    const body = chunk.substring(newlineIdx + 1);

    const basename = filePath.split('/').pop() || '';
    const match = basename.match(/^houston_scheduler_([A-Za-z0-9]+)_(.+)\.env$/);
    if (!match) continue;

    tasks.push({ template: match[1], name: match[2], parameters: parseEnvBody(body) });
  }

  return tasks;
}

async function readSchedulerTasks(ssh: NodeSSH): Promise<RawTask[]> {
  const result = await ssh.execCommand(`python3 ${shellQuote(SCHEDULER_TASK_SCRIPT)} 2>/dev/null`);
  if (result.code === 0 && result.stdout.trim()) {
    try {
      const parsed = JSON.parse(result.stdout);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as RawTask[];
    } catch { /* fall through to env-file parsing */ }
  }
  return await readTasksFromEnvFiles(ssh);
}

async function readCloudRemotes(ssh: NodeSSH): Promise<CloudRemote[]> {
  const namesResult = await ssh.execCommand('rclone listremotes 2>/dev/null');
  const names = (namesResult.stdout || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  if (names.length === 0) return [];

  const configResult = await ssh.execCommand('rclone config dump 2>/dev/null');
  let configMap: Record<string, { type?: string }> = {};
  try {
    configMap = JSON.parse(configResult.stdout || '{}');
  } catch { /* type lookup is optional */ }

  return names.map(name => ({
    name,
    type: configMap[name.replace(/:$/, '')]?.type ?? 'unknown',
  }));
}

const IDENTITY_NET_MARKER = '===HOUSTON-NET===';

async function readIdentity(ssh: NodeSSH): Promise<ServerIdentity> {
  const result = await ssh.execCommand(
    `hostname; hostname -f 2>/dev/null; cat /etc/machine-id 2>/dev/null; hostname -I 2>/dev/null; ` +
    `echo '${IDENTITY_NET_MARKER}'; ip -o -4 addr show 2>/dev/null | awk '{print $2" "$4}'`,
  );

  const [head, netBlock = ''] = (result.stdout || '').split(IDENTITY_NET_MARKER);
  const lines = head.split('\n').map(l => l.trim());

  const lanSubnets: string[] = [];
  for (const line of netBlock.split('\n')) {
    const [iface, cidr] = line.trim().split(/\s+/);
    if (!iface || !cidr) continue;
    // Loopback and tunnel interfaces do not describe a shared LAN.
    if (/^(lo|wg|tun|tap|ppp|zt|tailscale)/i.test(iface)) continue;
    lanSubnets.push(cidr);
  }

  return {
    hostname: lines[0] || '',
    fqdn: lines[1] || '',
    machineId: lines[2] || '',
    addresses: (lines[3] || '').split(/\s+/).filter(Boolean),
    lanSubnets,
  };
}

export async function probeServerTopology(host: string, username: string): Promise<ServerTopologyProbe> {
  const safeHost = assertSafeHost(host);
  const safeUser = assertSafeUsername(username);

  const base: ServerTopologyProbe = {
    host: safeHost,
    probedAt: Date.now(),
    reachable: false,
    rsyncTasks: [],
    replicationTasks: [],
    cloudSyncTasks: [],
    cloudRemotes: [],
  };

  const cred = getCredentialManager().getForHost(safeHost);
  const startedAt = Date.now();

  let ssh: NodeSSH;
  try {
    ssh = await acquireSSH(safeHost, {
      username: safeUser,
      method: cred?.sshKeyPath ? 'key' : 'password',
      password: cred?.password,
      privateKeyPath: cred?.sshKeyPath,
      passphrase: cred?.sshPassphrase,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('topology:probe.error', { host: safeHost, username: safeUser, error: message }, 'warn');
    return { ...base, error: message };
  }

  try {
    const identity = await readIdentity(ssh);
    const tasks = await readSchedulerTasks(ssh);
    const cloudRemotes = await readCloudRemotes(ssh);

    const rsyncTasks: RemoteRsyncTask[] = [];
    const replicationTasks: RemoteReplicationTask[] = [];
    const cloudSyncTasks: CloudSyncTask[] = [];

    for (const t of tasks) {
      const p = t.parameters || {};

      if (t.template === 'RsyncTask') {
        const remoteHost = p['rsyncConfig_target_info_host'] || '';
        if (!remoteHost) continue;
        rsyncTasks.push({
          name: t.name,
          localPath: p['rsyncConfig_local_path'] || '',
          remoteHost,
          remotePort: parseInt(p['rsyncConfig_target_info_port'] || '22', 10),
          remoteUser: p['rsyncConfig_target_info_user'] || 'root',
          remotePath: p['rsyncConfig_target_info_path'] || '',
          direction: (p['rsyncConfig_direction'] || 'push') as 'push' | 'pull',
        });
        continue;
      }

      if (t.template === 'ZfsReplicationTask') {
        replicationTasks.push({
          name: t.name,
          sourceDataset: joinZfs(
            p['zfsRepConfig_sourceDataset_pool'] || '',
            p['zfsRepConfig_sourceDataset_dataset'] || '',
          ),
          destDataset: joinZfs(
            p['zfsRepConfig_destDataset_pool'] || '',
            p['zfsRepConfig_destDataset_dataset'] || '',
          ),
          destHost: p['zfsRepConfig_destDataset_host'] || '',
          destUser: p['zfsRepConfig_destDataset_user'] || 'root',
          destSshPort: parseInt(p['zfsRepConfig_destDataset_sshPort'] || p['zfsRepConfig_destDataset_port'] || '22', 10),
          direction: (p['zfsRepConfig_direction'] || 'push') as 'push' | 'pull',
        });
        continue;
      }

      if (t.template === 'CloudSyncTask') {
        cloudSyncTasks.push({
          name: t.name,
          localPath: p['cloudSyncConfig_local_path'] || '',
          targetPath: p['cloudSyncConfig_target_path'] || '',
          remote: p['cloudSyncConfig_rclone_remote'] || '',
          provider: p['cloudSyncConfig_provider'] || p['cloudSyncConfig_type'] || 'cloud',
          direction: p['cloudSyncConfig_direction'] || 'push',
        });
      }
    }

    logEvent('topology:probe.done', {
      host: safeHost,
      username: safeUser,
      durationMs: Date.now() - startedAt,
      rsyncTasks: rsyncTasks.length,
      replicationTasks: replicationTasks.length,
      cloudSyncTasks: cloudSyncTasks.length,
      cloudRemotes: cloudRemotes.length,
    });

    return {
      ...base,
      probedAt: Date.now(),
      reachable: true,
      identity,
      rsyncTasks,
      replicationTasks,
      cloudSyncTasks,
      cloudRemotes,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('topology:probe.error', {
      host: safeHost, username: safeUser, durationMs: Date.now() - startedAt, error: message,
    }, 'warn');
    return { ...base, error: message };
  } finally {
    ssh.dispose();
  }
}
