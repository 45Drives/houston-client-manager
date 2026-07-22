// Main process: Server Management IPC handlers
// Probes a remote server via SSH to gather system info, and applies staged changes.
import { ipcMain } from 'electron';
import { NodeSSH } from 'node-ssh';
import fs from 'fs';
import path from 'path';
import type { Logger } from 'winston';
import { assertSafeHost, assertSafeUsername } from '../security';
import { getKeyDir } from '../crossPlatformSsh';
import { loadSettings } from '../settingsStore';

interface ServerManageContext {
  jsonLogger: Logger;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface ServerProbeResult {
  hostname: string;
  ips: Array<{ iface: string; addr: string }>;
  dns: string[];
  os: { name: string; version: string; pretty: string };
  uptime: string;
  cpu: { model: string; cores: number };
  memory: { totalMB: number; usedMB: number; freeMB: number };
  zfs: {
    pools: Array<{
      name: string;
      size: string;
      alloc: string;
      free: string;
      health: string;
    }>;
    datasets: Array<{
      name: string;
      used: string;
      avail: string;
      mountpoint: string;
    }>;
  };
  users: Array<{ username: string; uid: number; gid: number; home: string; shell: string }>;
  groups: Array<{ name: string; gid: number; members: string[] }>;
  sambaUsers: string[];
  samba: {
    global: Record<string, string>;
    shares: Array<{
      name: string;
      path: string;
      comment: string;
      guestOk: boolean;
      readOnly: boolean;
      browseable: boolean;
    }>;
  };
  services: Array<{ name: string; active: boolean }>;
}

export interface StagedChange {
  id: string;
  tab: string;
  label: string;
  field: string;
  oldValue: string;
  newValue: string;
  /** 'local' = update stored server only, 'remote' = SSH command on server */
  type: 'local' | 'remote';
}

// ── SSH helpers ────────────────────────────────────────────────────────────

async function connectSSH(host: string, username: string, password: string): Promise<NodeSSH> {
  const ssh = new NodeSSH();
  const keyDir = getKeyDir();
  const privateKeyPath = path.join(keyDir, 'id_rsa');

  await ssh.connect({
    host,
    username,
    privateKey: fs.existsSync(privateKeyPath) ? fs.readFileSync(privateKeyPath, 'utf-8') : undefined,
    password,
    readyTimeout: loadSettings().sshTimeoutMs,
  });
  return ssh;
}

async function cmd(ssh: NodeSSH, command: string): Promise<string> {
  const result = await ssh.execCommand(command);
  return result.stdout.trim();
}

// ── Probe functions ────────────────────────────────────────────────────────

async function probeSystem(ssh: NodeSSH) {
  const [hostname, uptimeRaw, cpuModel, cores, memRaw, osRelease] = await Promise.all([
    cmd(ssh, 'hostname'),
    cmd(ssh, 'uptime -p 2>/dev/null || uptime'),
    cmd(ssh, "lscpu 2>/dev/null | grep 'Model name' | sed 's/Model name:\\s*//'"),
    cmd(ssh, 'nproc 2>/dev/null || echo 1'),
    cmd(ssh, 'free -m | grep Mem'),
    cmd(ssh, 'cat /etc/os-release 2>/dev/null'),
  ]);

  // Parse memory
  const memParts = memRaw.split(/\s+/);
  const totalMB = parseInt(memParts[1]) || 0;
  const usedMB = parseInt(memParts[2]) || 0;
  const freeMB = parseInt(memParts[3]) || 0;

  // Parse os-release
  const osFields: Record<string, string> = {};
  for (const line of osRelease.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) {
      osFields[line.slice(0, eq)] = line.slice(eq + 1).replace(/^"|"$/g, '');
    }
  }

  return {
    hostname,
    uptime: uptimeRaw,
    cpu: { model: cpuModel || 'Unknown', cores: parseInt(cores) || 1 },
    memory: { totalMB, usedMB, freeMB },
    os: {
      name: osFields['NAME'] || 'Linux',
      version: osFields['VERSION_ID'] || '',
      pretty: osFields['PRETTY_NAME'] || 'Linux',
    },
  };
}

async function probeNetwork(ssh: NodeSSH) {
  const [ipRaw, dnsRaw] = await Promise.all([
    cmd(ssh, "ip -4 -o addr show scope global 2>/dev/null | awk '{print $2, $4}'"),
    cmd(ssh, "grep '^nameserver' /etc/resolv.conf 2>/dev/null | awk '{print $2}'"),
  ]);

  const ips = ipRaw.split('\n').filter(Boolean).map(line => {
    const [iface, addrCidr] = line.split(/\s+/);
    return { iface, addr: (addrCidr || '').split('/')[0] };
  });

  const dns = dnsRaw.split('\n').filter(Boolean);

  return { ips, dns };
}

async function probeZFS(ssh: NodeSSH) {
  const [poolsRaw, datasetsRaw] = await Promise.all([
    cmd(ssh, 'zpool list -H -o name,size,alloc,free,health 2>/dev/null'),
    cmd(ssh, 'zfs list -H -o name,used,avail,mountpoint 2>/dev/null'),
  ]);

  const pools = poolsRaw.split('\n').filter(Boolean).map(line => {
    const [name, size, alloc, free, health] = line.split('\t');
    return { name, size, alloc, free, health };
  });

  const datasets = datasetsRaw.split('\n').filter(Boolean).map(line => {
    const [name, used, avail, mountpoint] = line.split('\t');
    return { name, used, avail, mountpoint };
  });

  return { pools, datasets };
}

async function probeUsersGroups(ssh: NodeSSH) {
  const [usersRaw, groupsRaw, sambaUsersRaw] = await Promise.all([
    cmd(ssh, "getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 {print $1\":\"$3\":\"$4\":\"$6\":\"$7}'"),
    cmd(ssh, "getent group | awk -F: '$3 >= 1000 || $1 == \"smbusers\" || $1 == \"wheel\" || $1 == \"sudo\" {print $0}'"),
    cmd(ssh, 'pdbedit -L 2>/dev/null | cut -d: -f1'),
  ]);

  const users = usersRaw.split('\n').filter(Boolean).map(line => {
    const [username, uid, gid, home, shell] = line.split(':');
    return { username, uid: parseInt(uid), gid: parseInt(gid), home, shell };
  });

  const groups = groupsRaw.split('\n').filter(Boolean).map(line => {
    const [name, , gidStr, membersStr] = line.split(':');
    return {
      name,
      gid: parseInt(gidStr),
      members: membersStr ? membersStr.split(',').filter(Boolean) : [],
    };
  });

  const sambaUsers = sambaUsersRaw.split('\n').filter(Boolean);

  return { users, groups, sambaUsers };
}

async function probeSamba(ssh: NodeSSH) {
  const confRaw = await cmd(ssh, 'testparm -s 2>/dev/null || cat /etc/samba/smb.conf 2>/dev/null');

  const global: Record<string, string> = {};
  const shares: Array<{ name: string; path: string; comment: string; guestOk: boolean; readOnly: boolean; browseable: boolean }> = [];

  let currentSection = '';
  let currentShare: Record<string, string> = {};

  function flushShare() {
    if (currentSection && currentSection !== 'global') {
      shares.push({
        name: currentSection,
        path: currentShare['path'] || '',
        comment: currentShare['comment'] || '',
        guestOk: (currentShare['guest ok'] || 'no').toLowerCase() === 'yes',
        readOnly: (currentShare['read only'] || 'yes').toLowerCase() === 'yes',
        browseable: (currentShare['browseable'] || currentShare['browsable'] || 'yes').toLowerCase() === 'yes',
      });
    }
  }

  for (const line of confRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      flushShare();
      currentSection = sectionMatch[1];
      currentShare = {};
      continue;
    }

    const kvMatch = trimmed.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim().toLowerCase();
      const val = kvMatch[2].trim();
      if (currentSection === 'global') {
        global[key] = val;
      } else {
        currentShare[key] = val;
      }
    }
  }
  flushShare();

  return { global, shares };
}

async function probeServices(ssh: NodeSSH) {
  const serviceNames = ['smbd', 'smb', 'sshd', 'houston-broadcaster', 'cockpit', 'zed', 'ntp', 'chronyd', 'rclone'];
  const checks = await Promise.all(
    serviceNames.map(async (name) => {
      const result = await cmd(ssh, `systemctl is-active ${name} 2>/dev/null`);
      return { name, active: result === 'active' };
    })
  );
  return checks.filter(s => s.active || ['smbd', 'smb', 'sshd', 'houston-broadcaster'].includes(s.name));
}

// ── Apply changes ──────────────────────────────────────────────────────────

interface ApplyResult {
  success: boolean;
  applied: string[];
  failed: Array<{ label: string; error: string }>;
  rebootRequired: boolean;
}

async function applyRemoteChanges(
  ssh: NodeSSH,
  changes: StagedChange[],
): Promise<ApplyResult> {
  const applied: string[] = [];
  const failed: Array<{ label: string; error: string }> = [];
  let rebootRequired = false;

  for (const change of changes) {
    if (change.type !== 'remote') continue;

    try {
      switch (change.field) {
        case 'hostname': {
          const hostname = change.newValue.trim();
          if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(hostname)) {
            failed.push({ label: change.label, error: 'Invalid hostname format' });
            continue;
          }
          await ssh.execCommand(`hostnamectl set-hostname "${hostname}"`);
          // Update /etc/hosts
          await ssh.execCommand(`sed -i "s/127\\.0\\.1\\.1\\s.*/127.0.1.1\\t${hostname}/" /etc/hosts`);
          await ssh.execCommand(`grep -q '^127\\.0\\.1\\.1' /etc/hosts || echo -e '127.0.1.1\\t${hostname}' >> /etc/hosts`);
          rebootRequired = true;
          applied.push(change.label);
          break;
        }

        default:
          failed.push({ label: change.label, error: `Unknown remote field: ${change.field}` });
      }
    } catch (e: any) {
      failed.push({ label: change.label, error: e?.message || String(e) });
    }
  }

  return { success: failed.length === 0, applied, failed, rebootRequired };
}

// ── Registration ───────────────────────────────────────────────────────────

export function registerServerManageHandlers(ctx: ServerManageContext) {
  const { jsonLogger } = ctx;

  // Probe a server for system information
  ipcMain.handle('server:probe', async (event, { host, username, password }: { host: string; username: string; password: string }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'server:probe', host: safeHost });

    const ssh = await connectSSH(safeHost, username, password);
    try {
      const [system, network, zfs, usersGroups, samba, services] = await Promise.all([
        probeSystem(ssh),
        probeNetwork(ssh),
        probeZFS(ssh),
        probeUsersGroups(ssh),
        probeSamba(ssh),
        probeServices(ssh),
      ]);

      const result: ServerProbeResult = {
        hostname: system.hostname,
        ips: network.ips,
        dns: network.dns,
        os: system.os,
        uptime: system.uptime,
        cpu: system.cpu,
        memory: system.memory,
        zfs,
        users: usersGroups.users,
        groups: usersGroups.groups,
        sambaUsers: usersGroups.sambaUsers,
        samba,
        services,
      };

      jsonLogger.info({ event: 'server:probe_success', host: safeHost });
      return { success: true, data: result };
    } catch (e: any) {
      jsonLogger.error({ event: 'server:probe_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message || String(e) };
    } finally {
      ssh.dispose();
    }
  });

  // Apply staged changes to a server
  ipcMain.handle('server:apply-changes', async (event, {
    host, username, password, changes,
  }: {
    host: string; username: string; password: string; changes: StagedChange[];
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'server:apply-changes', host: safeHost, changeCount: changes.length });

    const remoteChanges = changes.filter(c => c.type === 'remote');
    if (remoteChanges.length === 0) {
      return { success: true, applied: [], failed: [], rebootRequired: false };
    }

    const ssh = await connectSSH(safeHost, username, password);
    try {
      const result = await applyRemoteChanges(ssh, remoteChanges);
      jsonLogger.info({ event: 'server:apply-changes_done', host: safeHost, result });
      return result;
    } catch (e: any) {
      jsonLogger.error({ event: 'server:apply-changes_error', host: safeHost, error: String(e) });
      return { success: false, applied: [], failed: [{ label: 'Connection', error: e?.message || String(e) }], rebootRequired: false };
    } finally {
      ssh.dispose();
    }
  });

  // Reboot a server
  ipcMain.handle('server:reboot', async (event, { host, username, password }: { host: string; username: string; password: string }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'server:reboot', host: safeHost });

    const ssh = await connectSSH(safeHost, username, password);
    try {
      // Fire-and-forget reboot — the SSH connection will drop
      ssh.execCommand('sleep 1 && reboot &').catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 2000));
      return { success: true };
    } catch (e: any) {
      // Connection drop during reboot is expected
      return { success: true };
    } finally {
      ssh.dispose();
    }
  });
}
