// Main process: Server Management IPC handlers
// Probes a remote server via SSH to gather system info, and applies staged changes.
// Also provides a single `server:manage` action router for ZFS, User, Group, and Samba operations.
import { ipcMain } from 'electron';
import { NodeSSH } from 'node-ssh';
import fs from 'fs';
import path from 'path';
import type { Logger } from 'winston';
import { assertSafeHost, assertSafeUsername } from '../security';
import { getAgentSocket, getKeyDir, ensureKeyPair } from '../crossPlatformSsh';
import { loadSettings } from '../settingsStore';
import { connectWithFallback, type SshAuth } from '../setupSsh';
import { getCredentialManager } from '../credentialManager';

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

async function connectSSH(host: string, username: string, password: string, sshKeyPath?: string, sshPassphrase?: string): Promise<NodeSSH> {
  if (sshKeyPath) {
    return connectWithFallback(host, { username, method: 'key', privateKeyPath: sshKeyPath, passphrase: sshPassphrase });
  }
  return connectWithFallback(host, { username, method: 'password', password });
}

async function cmd(ssh: NodeSSH, command: string): Promise<string> {
  const result = await ssh.execCommand(command);
  return result.stdout.trim();
}

async function sudoCmd(ssh: NodeSSH, command: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const result = await ssh.execCommand(`sudo ${command} 2>&1`);
  return { code: result.code, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
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
  // Check all services in a single SSH command to avoid channel exhaustion
  const serviceNames = ['smbd', 'smb', 'sshd', 'houston-broadcaster', 'cockpit', 'zed', 'ntp', 'chronyd', 'rclone'];
  const checkCmd = serviceNames.map(n => `echo "${n}:$(systemctl is-active ${n} 2>/dev/null)"`).join('; ');
  const raw = await cmd(ssh, checkCmd);
  const checks = raw.split('\n').filter(Boolean).map(line => {
    const [name, status] = line.split(':');
    return { name, active: status === 'active' };
  });
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

          // Skip if already set
          const current = (await cmd(ssh, 'hostname')).trim();
          if (hostname === current) {
            applied.push(change.label);
            break;
          }

          // Detect distro (matches EasySetupConfigurator.getLinuxDistro)
          const osRelease = await cmd(ssh, 'cat /etc/os-release 2>/dev/null || true');
          const distro = /rocky/i.test(osRelease) ? 'rocky' : /ubuntu/i.test(osRelease) ? 'ubuntu' : 'unknown';

          // 1) Persist hostname files (matches server.writeHostnameFiles)
          const rh = await sudoCmd(ssh, `bash -c ${shellQuote(`printf '%s\\n' '${hostname}' | tee /etc/hostname`)}`);
          if (rh.code !== 0 && rh.code !== null) {
            failed.push({ label: change.label, error: `Failed to write /etc/hostname: ${rh.stdout || rh.stderr}` });
            continue;
          }
          await sudoCmd(ssh, `bash -c ${shellQuote(`printf 'PRETTY_HOSTNAME="%s"\\n' '${hostname}' | tee /etc/machine-info`)}`);

          // 2) Update /etc/hosts
          await sudoCmd(ssh, `sed -i ${shellQuote(`s/127\\.0\\.1\\.1\\s.*/127.0.1.1\\t${hostname}/`)} /etc/hosts`);
          await sudoCmd(ssh, `bash -c ${shellQuote(`grep -q '^127\\.0\\.1\\.1' /etc/hosts || printf '127.0.1.1\\t%s\\n' '${hostname}' >> /etc/hosts`)}`);

          // 3) Set runtime hostname (matches EasySetupConfigurator: hostnamectl on Ubuntu, kernel hostname on Rocky)
          if (distro === 'ubuntu') {
            await sudoCmd(ssh, `hostnamectl set-hostname ${shellQuote(hostname)}`);
          } else {
            await sudoCmd(ssh, `hostname ${shellQuote(hostname)}`);
          }

          // 4) Bounce daemons that read hostname (quietly, matching EasySetupConfigurator)
          await sudoCmd(ssh, 'systemctl restart systemd-hostnamed 2>/dev/null || true');
          await sudoCmd(ssh, 'systemctl restart avahi-daemon 2>/dev/null || true');
          await sudoCmd(ssh, 'systemctl restart houston-broadcaster-legacy.service 2>/dev/null || true');

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

// ── Management action router ───────────────────────────────────────────────

type ActionResult = { success: boolean; error?: string; data?: any };

async function executeManageAction(
  ssh: NodeSSH,
  action: string,
  params: Record<string, any>,
  logger: Logger,
): Promise<ActionResult> {
  switch (action) {

    // ── ZFS Pool operations ──────────────────────────────────────────────

    case 'zfs:pool-status': {
      const pool = params.pool as string;
      if (!pool) return { success: false, error: 'Pool name required' };
      const raw = await cmd(ssh, `zpool status ${shellQuote(pool)} 2>&1`);
      return { success: true, data: { raw } };
    }

    case 'zfs:pool-io': {
      const pool = params.pool as string;
      if (!pool) return { success: false, error: 'Pool name required' };
      const raw = await cmd(ssh, `zpool iostat ${shellQuote(pool)} -v 2>/dev/null`);
      return { success: true, data: { raw } };
    }

    case 'zfs:list-disks': {
      const raw = await cmd(ssh, 'lsblk -J -d -o NAME,SIZE,TYPE,MODEL,SERIAL,ROTA -e 1,7,11,253 2>/dev/null');

      // Get disks in use by ZFS pools (resolve by-vdev/by-path symlinks to sd names)
      const zpoolDevsRaw = await cmd(ssh, "zpool status 2>/dev/null | awk '/^\t  / && $1 !~ /^(mirror|raidz|spare|log|cache|NAME|state)/ {print $1}'");
      const zpoolDevEntries = zpoolDevsRaw.split('\n').map(s => s.trim()).filter(Boolean);
      // Resolve symlinks (by-vdev/by-path) to real device names
      const resolveUsedCmd = zpoolDevEntries.map(d =>
        d.startsWith('/dev/') ? `readlink -f "${d}" 2>/dev/null || echo "${d}"` : `echo "${d}"`
      ).join('; ');
      const resolvedUsed = resolveUsedCmd ? await cmd(ssh, resolveUsedCmd) : '';
      const usedDevNames = new Set(
        resolvedUsed.split('\n').map(s => s.trim().replace(/^\/dev\//, '')).filter(Boolean)
      );

      // Get boot/OS disks to exclude
      const bootDevs = await cmd(ssh, "lsblk -n -o PKNAME,MOUNTPOINT -e 1,7,11,253 2>/dev/null | awk '$2 ~ /^\\/(boot)?$|\\[SWAP\\]/ {print $1}' | sort -u");
      for (const d of bootDevs.split('\n').map(s => s.trim()).filter(Boolean)) {
        usedDevNames.add(d);
      }

      // Try vdev_id.conf for 45Drives alias mapping
      const vdevConfRaw = await cmd(ssh, "test -f /etc/vdev_id.conf && grep '^alias ' /etc/vdev_id.conf | awk '{print $2, $3}' || true");
      const vdevLines = vdevConfRaw.split('\n').filter(Boolean);
      let devToAlias: Record<string, string> = {};
      if (vdevLines.length > 0) {
        const paths = vdevLines.map(l => l.split(/\s+/)[1]).filter(Boolean);
        if (paths.length > 0) {
          const resolveCmd = paths.map(p => `readlink -f "${p}" 2>/dev/null`).join('; ');
          const resolved = await cmd(ssh, resolveCmd);
          const resolvedLines = resolved.split('\n');
          for (let i = 0; i < resolvedLines.length && i < vdevLines.length; i++) {
            const devPath = resolvedLines[i]!.trim();
            const alias = vdevLines[i]!.split(/\s+/)[0];
            if (devPath.startsWith('/dev/') && alias) {
              devToAlias[devPath.replace('/dev/', '')] = alias;
            }
          }
        }
      }

      // Try lsdev -j for richer disk info (45Drives tool)
      let lsdevInfo: Record<string, { bayId?: string; health?: string; temp?: string }> = {};
      try {
        const lsdevRaw = await cmd(ssh, 'lsdev -jd 2>/dev/null || true');
        if (lsdevRaw.startsWith('{') || lsdevRaw.startsWith('[')) {
          const lsdevParsed = JSON.parse(lsdevRaw);
          const rows = lsdevParsed.rows || lsdevParsed;
          for (const row of (Array.isArray(rows) ? rows : [])) {
            const slots = Array.isArray(row) ? row : [row];
            for (const slot of slots) {
              if (slot.occupied && slot.dev) {
                const devName = slot.dev.replace('/dev/', '');
                lsdevInfo[devName] = {
                  bayId: slot['bay-id'] || undefined,
                  health: slot.health || undefined,
                  temp: slot['temp-c'] || undefined,
                };
              }
            }
          }
        }
      } catch { /* lsdev not available — ignore */ }

      try {
        const parsed = JSON.parse(raw);
        const allDisks = (parsed.blockdevices || [])
          .filter((d: any) => d.type === 'disk')
          .map((d: any) => ({
            name: d.name,
            size: d.size,
            model: d.model?.trim() || undefined,
            serial: d.serial?.trim() || undefined,
            rota: d.rota,
            type: d.rota === '0' ? (d.name.startsWith('nvme') ? 'NVMe' : 'SSD') : 'HDD',
            alias: devToAlias[d.name] || lsdevInfo[d.name]?.bayId || undefined,
            health: lsdevInfo[d.name]?.health || undefined,
            temp: lsdevInfo[d.name]?.temp || undefined,
          }));
        // Sort by alias numerically if available
        allDisks.sort((a: any, b: any) => {
          if (a.alias && b.alias) {
            const pa = a.alias.split('-').map(Number);
            const pb = b.alias.split('-').map(Number);
            return (pa[0] - pb[0]) || (pa[1] - pb[1]);
          }
          return a.name.localeCompare(b.name);
        });
        const available = allDisks.filter((d: any) => !usedDevNames.has(d.name));
        return { success: true, data: { all: allDisks, available, usedNames: [...usedDevNames] } };
      } catch {
        return { success: true, data: { all: [], available: [], usedNames: [] } };
      }
    }

    case 'zfs:pool-create': {
      const { name, vdevType, disks, properties } = params as {
        name: string; vdevType: string; disks: { name: string; alias?: string }[] | string[]; properties?: Record<string, string>;
      };
      if (!name || !disks?.length) return { success: false, error: 'Pool name and disks required' };
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return { success: false, error: 'Invalid pool name' };

      const propFlags = Object.entries(properties || {}).map(([k, v]) => `-o ${shellQuote(`${k}=${v}`)}`).join(' ');
      // Use by-vdev path if alias exists, otherwise /dev/name
      const diskPaths = disks.map(d => {
        if (typeof d === 'string') return `/dev/${d}`;
        return d.alias ? `/dev/disk/by-vdev/${d.alias}` : `/dev/${d.name}`;
      }).join(' ');
      const vdev = vdevType && vdevType !== 'disk' ? `${vdevType} ` : '';

      const r = await sudoCmd(ssh, `zpool create ${propFlags} ${shellQuote(name)} ${vdev}${diskPaths}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    case 'zfs:vdev-add': {
      const { pool, vdevType, disks } = params as { pool: string; vdevType: string; disks: string[] };
      if (!pool || !disks?.length) return { success: false, error: 'Pool and disks required' };
      const diskPaths = disks.map(d => `/dev/${d}`).join(' ');
      const vdev = vdevType && vdevType !== 'stripe' ? `${vdevType} ` : '';
      const r = await sudoCmd(ssh, `zpool add ${shellQuote(pool)} ${vdev}${diskPaths}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    case 'zfs:disk-attach': {
      const { pool, existingDisk, newDisk } = params as { pool: string; existingDisk: string; newDisk: string };
      if (!pool || !existingDisk || !newDisk) return { success: false, error: 'Pool, existing disk, and new disk required' };
      const r = await sudoCmd(ssh, `zpool attach ${shellQuote(pool)} ${existingDisk} /dev/${newDisk}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    case 'zfs:disk-detach': {
      const { pool, disk } = params as { pool: string; disk: string };
      if (!pool || !disk) return { success: false, error: 'Pool and disk required' };
      const r = await sudoCmd(ssh, `zpool detach ${shellQuote(pool)} ${disk}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    case 'zfs:disk-offline': {
      const { pool, disk } = params as { pool: string; disk: string };
      if (!pool || !disk) return { success: false, error: 'Pool and disk required' };
      const r = await sudoCmd(ssh, `zpool offline ${shellQuote(pool)} ${disk}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    case 'zfs:disk-online': {
      const { pool, disk } = params as { pool: string; disk: string };
      if (!pool || !disk) return { success: false, error: 'Pool and disk required' };
      const r = await sudoCmd(ssh, `zpool online ${shellQuote(pool)} ${disk}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    case 'zfs:disk-replace': {
      const { pool, oldDisk, newDisk } = params as { pool: string; oldDisk: string; newDisk: string };
      if (!pool || !oldDisk || !newDisk) return { success: false, error: 'Pool, old disk, and new disk required' };
      const r = await sudoCmd(ssh, `zpool replace ${shellQuote(pool)} ${oldDisk} /dev/${newDisk}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    // ── ZFS Dataset operations ───────────────────────────────────────────

    case 'zfs:dataset-create': {
      const { name, properties } = params as { name: string; properties?: Record<string, string> };
      if (!name) return { success: false, error: 'Dataset name required' };
      if (!/^[a-zA-Z0-9_.\/:@-]+$/.test(name)) return { success: false, error: 'Invalid dataset name' };
      const propFlags = Object.entries(properties || {}).map(([k, v]) => `-o ${shellQuote(`${k}=${v}`)}`).join(' ');
      const r = await sudoCmd(ssh, `zfs create ${propFlags} ${shellQuote(name)}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    case 'zfs:dataset-destroy': {
      const { name, recursive } = params as { name: string; recursive?: boolean };
      if (!name) return { success: false, error: 'Dataset name required' };
      const flags = recursive ? '-r' : '';
      const r = await sudoCmd(ssh, `zfs destroy ${flags} ${shellQuote(name)}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    case 'zfs:dataset-get-props': {
      const { name } = params as { name: string };
      if (!name) return { success: false, error: 'Dataset name required' };
      const raw = await cmd(ssh,
        `zfs get -H -o property,value,source mountpoint,quota,recordsize,compression,atime,casesensitivity,dedup,readonly,reservation,refreservation,refquota,sync,xattr,acltype ${shellQuote(name)} 2>/dev/null`
      );
      const props: Record<string, { value: string; source: string }> = {};
      for (const line of raw.split('\n').filter(Boolean)) {
        const [prop, value, source] = line.split('\t');
        if (prop) props[prop] = { value, source };
      }
      return { success: true, data: props };
    }

    case 'zfs:dataset-set-prop': {
      const { name, property, value } = params as { name: string; property: string; value: string };
      if (!name || !property) return { success: false, error: 'Dataset name and property required' };
      // Allowlist of safe properties
      const allowed = ['mountpoint', 'quota', 'recordsize', 'compression', 'atime', 'dedup', 'readonly', 'reservation', 'refreservation', 'refquota', 'sync', 'xattr', 'acltype'];
      if (!allowed.includes(property)) return { success: false, error: `Property "${property}" is not configurable` };
      const r = await sudoCmd(ssh, `zfs set ${shellQuote(`${property}=${value}`)} ${shellQuote(name)}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    // ── ZFS Snapshot operations ──────────────────────────────────────────

    case 'zfs:snapshot-list': {
      const { dataset } = params as { dataset?: string };
      const target = dataset ? shellQuote(dataset) : '';
      const raw = await cmd(ssh, `zfs list -H -o name,creation,used,referenced -t snapshot ${target} 2>/dev/null`);
      const snapshots = raw.split('\n').filter(Boolean).map(line => {
        const [name, creation, used, referenced] = line.split('\t');
        const atIdx = name.indexOf('@');
        return { name, dataset: name.substring(0, atIdx), snapName: name.substring(atIdx + 1), creation, used, referenced };
      });
      return { success: true, data: snapshots };
    }

    case 'zfs:snapshot-create': {
      const { dataset, snapName, recursive } = params as { dataset: string; snapName: string; recursive?: boolean };
      if (!dataset || !snapName) return { success: false, error: 'Dataset and snapshot name required' };
      if (!/^[A-Za-z0-9._:-]+$/.test(snapName)) return { success: false, error: 'Invalid snapshot name' };
      const flags = recursive ? '-r' : '';
      const fullName = `${dataset}@${snapName}`;
      const r = await sudoCmd(ssh, `zfs snapshot ${flags} ${shellQuote(fullName)}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true, data: { snapshotName: fullName } };
    }

    case 'zfs:snapshot-destroy': {
      const { name, recursive } = params as { name: string; recursive?: boolean };
      if (!name) return { success: false, error: 'Snapshot name required' };
      const flags = recursive ? '-r' : '';
      const r = await sudoCmd(ssh, `zfs destroy ${flags} ${shellQuote(name)}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    case 'zfs:snapshot-rollback': {
      const { name } = params as { name: string };
      if (!name) return { success: false, error: 'Snapshot name required' };
      const r = await sudoCmd(ssh, `zfs rollback -r ${shellQuote(name)}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    // ── User operations ──────────────────────────────────────────────────

    case 'user:add': {
      const { username: newUser, password: newPass, groups, shell } = params as {
        username: string; password?: string; groups?: string[]; shell?: string;
      };
      if (!newUser) return { success: false, error: 'Username required' };
      if (!/^[a-z_][a-z0-9_-]*$/.test(newUser)) return { success: false, error: 'Invalid username (lowercase, alphanumeric, dash, underscore)' };
      const shellFlag = shell ? `-s ${shellQuote(shell)}` : '';
      let r = await sudoCmd(ssh, `useradd --create-home ${shellFlag} ${shellQuote(newUser)}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      if (newPass) {
        r = await sudoCmd(ssh, `bash -c ${shellQuote(`echo '${newUser}:${newPass}' | chpasswd`)}`);
        if (r.code !== 0 && r.code !== null) return { success: false, error: `User created but password failed: ${r.stdout}` };
      }
      if (groups?.length) {
        r = await sudoCmd(ssh, `usermod -aG ${groups.join(',')} ${shellQuote(newUser)}`);
        if (r.code !== 0 && r.code !== null) return { success: false, error: `User created but group assignment failed: ${r.stdout}` };
      }
      return { success: true };
    }

    case 'user:set-password': {
      const { username: targetUser, password: targetPass } = params as { username: string; password: string };
      if (!targetUser || !targetPass) return { success: false, error: 'Username and password required' };
      const r = await sudoCmd(ssh, `bash -c ${shellQuote(`echo '${targetUser}:${targetPass}' | chpasswd`)}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    case 'user:set-groups': {
      const { username: targetUser, groups } = params as { username: string; groups: string[] };
      if (!targetUser || !groups) return { success: false, error: 'Username and groups required' };
      const r = await sudoCmd(ssh, `usermod -G ${groups.join(',')} ${shellQuote(targetUser)}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    case 'user:delete': {
      const { username: targetUser } = params as { username: string };
      if (!targetUser) return { success: false, error: 'Username required' };
      // Prevent deleting system-critical users
      const protected_users = ['root', 'nobody', 'systemd-network', 'sshd', 'messagebus', 'avahi'];
      if (protected_users.includes(targetUser)) return { success: false, error: `Cannot delete protected user "${targetUser}"` };
      const r = await sudoCmd(ssh, `userdel ${shellQuote(targetUser)}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    case 'user:add-ssh-key': {
      const { username: targetUser, publicKey } = params as { username: string; publicKey: string };
      if (!targetUser || !publicKey) return { success: false, error: 'Username and public key required' };
      if (!/^(ssh-(rsa|ed25519)|ecdsa-sha2)\s/.test(publicKey.trim())) return { success: false, error: 'Invalid SSH public key format' };
      const homeDir = await cmd(ssh, `getent passwd ${shellQuote(targetUser)} | cut -d: -f6`);
      if (!homeDir) return { success: false, error: 'Could not determine home directory' };
      await sudoCmd(ssh, `mkdir -p ${shellQuote(`${homeDir}/.ssh`)} && chmod 700 ${shellQuote(`${homeDir}/.ssh`)}`);
      // Append key if not already present
      const safeKey = publicKey.trim().replace(/'/g, "'\\''");
      await sudoCmd(ssh, `grep -qF ${shellQuote(safeKey)} ${shellQuote(`${homeDir}/.ssh/authorized_keys`)} 2>/dev/null || echo ${shellQuote(safeKey)} >> ${shellQuote(`${homeDir}/.ssh/authorized_keys`)}`);
      await sudoCmd(ssh, `chmod 600 ${shellQuote(`${homeDir}/.ssh/authorized_keys`)} && chown -R ${shellQuote(targetUser)}:${shellQuote(targetUser)} ${shellQuote(`${homeDir}/.ssh`)}`);
      return { success: true };
    }

    // ── Group operations ─────────────────────────────────────────────────

    case 'group:add': {
      const { name: groupName } = params as { name: string };
      if (!groupName) return { success: false, error: 'Group name required' };
      if (!/^[a-z_][a-z0-9_-]*$/.test(groupName)) return { success: false, error: 'Invalid group name' };
      const r = await sudoCmd(ssh, `groupadd ${shellQuote(groupName)}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    case 'group:delete': {
      const { name: groupName } = params as { name: string };
      if (!groupName) return { success: false, error: 'Group name required' };
      const protected_groups = ['root', 'wheel', 'sudo', 'smbusers', 'users', 'adm', 'staff'];
      if (protected_groups.includes(groupName)) return { success: false, error: `Cannot delete protected group "${groupName}"` };
      const r = await sudoCmd(ssh, `groupdel ${shellQuote(groupName)}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    // ── Samba operations ─────────────────────────────────────────────────

    case 'samba:set-user-password': {
      const { username: smbUser, password: smbPass } = params as { username: string; password: string };
      if (!smbUser || !smbPass) return { success: false, error: 'Username and password required' };
      const r = await sudoCmd(ssh, `bash -c ${shellQuote(`(echo '${smbPass}'; echo '${smbPass}') | smbpasswd -s -a '${smbUser}'`)}`);
      if (r.code !== 0 && r.code !== null) return { success: false, error: r.stdout || r.stderr };
      return { success: true };
    }

    case 'samba:share-add': {
      const { name: shareName, path: sharePath, comment, guestOk, readOnly, browseable } = params as {
        name: string; path: string; comment?: string; guestOk?: boolean; readOnly?: boolean; browseable?: boolean;
      };
      if (!shareName || !sharePath) return { success: false, error: 'Share name and path required' };
      if (!/^[a-zA-Z0-9_ -]+$/.test(shareName)) return { success: false, error: 'Invalid share name' };

      // Build share config block
      const lines = [
        `[${shareName}]`,
        `   path = ${sharePath}`,
        `   comment = ${comment || shareName}`,
        `   browseable = ${browseable !== false ? 'yes' : 'no'}`,
        `   read only = ${readOnly === true ? 'yes' : 'no'}`,
        `   guest ok = ${guestOk === true ? 'yes' : 'no'}`,
        `   create mask = 0660`,
        `   directory mask = 2770`,
        `   force group = smbusers`,
      ];
      const confBlock = lines.join('\\n');
      // Ensure path exists
      await sudoCmd(ssh, `mkdir -p ${shellQuote(sharePath)}`);
      // Append to smb.conf
      await sudoCmd(ssh, `echo -e '\\n${confBlock}' >> /etc/samba/smb.conf`);
      // Reload samba
      await sudoCmd(ssh, 'systemctl reload smbd 2>/dev/null || systemctl reload smb 2>/dev/null || true');
      return { success: true };
    }

    case 'samba:share-edit': {
      const { name: shareName, settings } = params as {
        name: string; settings: Record<string, string>;
      };
      if (!shareName || !settings) return { success: false, error: 'Share name and settings required' };

      // Use sed to update individual settings within the share block
      for (const [key, value] of Object.entries(settings)) {
        // Try to replace existing setting first, add if not found
        await sudoCmd(ssh,
          `sed -i "/^\\[${shareName}\\]/,/^\\[/ { s|^\\(\\s*\\)${key}\\s*=.*|\\1${key} = ${value}|; }" /etc/samba/smb.conf`
        );
      }
      await sudoCmd(ssh, 'systemctl reload smbd 2>/dev/null || systemctl reload smb 2>/dev/null || true');
      return { success: true };
    }

    case 'samba:share-remove': {
      const { name: shareName } = params as { name: string };
      if (!shareName) return { success: false, error: 'Share name required' };
      // Remove the entire share block from smb.conf
      await sudoCmd(ssh,
        `sed -i '/^\\[${shareName}\\]/,/^\\[/{/^\\[${shareName}\\]/d;/^\\[/!d;}' /etc/samba/smb.conf`
      );
      await sudoCmd(ssh, 'systemctl reload smbd 2>/dev/null || systemctl reload smb 2>/dev/null || true');
      return { success: true };
    }

    case 'samba:global-edit': {
      const { settings } = params as { settings: Record<string, string> };
      if (!settings) return { success: false, error: 'Settings required' };
      // Allowlist of safe global settings
      const allowed = ['workgroup', 'server string', 'log level', 'server role', 'map to guest', 'usershare allow guests'];
      for (const [key, value] of Object.entries(settings)) {
        if (!allowed.includes(key)) continue;
        await sudoCmd(ssh,
          `sed -i "/^\\[global\\]/,/^\\[/ { s|^\\(\\s*\\)${key}\\s*=.*|\\1${key} = ${value}|; }" /etc/samba/smb.conf`
        );
      }
      await sudoCmd(ssh, 'systemctl reload smbd 2>/dev/null || systemctl reload smb 2>/dev/null || true');
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

// ── Registration ───────────────────────────────────────────────────────────

export function registerServerManageHandlers(ctx: ServerManageContext) {
  const { jsonLogger } = ctx;

  // Probe a server for system information
  ipcMain.handle('server:probe', async (event, { host, username, password }: { host: string; username: string; password: string }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'server:probe', host: safeHost });

    // If no password provided, check credential store for SSH key
    let sshKeyPath: string | undefined;
    let sshPassphrase: string | undefined;
    if (!password) {
      const stored = getCredentialManager().getForHost(safeHost);
      if (stored) {
        sshKeyPath = stored.sshKeyPath || undefined;
        sshPassphrase = stored.sshPassphrase || undefined;
      }
    }

    let ssh: NodeSSH | undefined;
    try {
      ssh = await connectSSH(safeHost, username, password, sshKeyPath, sshPassphrase);

      // Run probes sequentially to avoid exceeding SSH channel limits
      const system = await probeSystem(ssh);
      const network = await probeNetwork(ssh);
      const zfs = await probeZFS(ssh);
      const usersGroups = await probeUsersGroups(ssh);
      const samba = await probeSamba(ssh);
      const services = await probeServices(ssh);

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
      ssh?.dispose();
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

    let ssh: NodeSSH | undefined;
    try {
      ssh = await connectSSH(safeHost, username, password);
      const result = await applyRemoteChanges(ssh, remoteChanges);
      jsonLogger.info({ event: 'server:apply-changes_done', host: safeHost, result });
      return result;
    } catch (e: any) {
      jsonLogger.error({ event: 'server:apply-changes_error', host: safeHost, error: String(e) });
      return { success: false, applied: [], failed: [{ label: 'Connection', error: e?.message || String(e) }], rebootRequired: false };
    } finally {
      ssh?.dispose();
    }
  });

  // Reboot a server
  ipcMain.handle('server:reboot', async (event, { host, username, password }: { host: string; username: string; password: string }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'server:reboot', host: safeHost });

    let ssh: NodeSSH | undefined;
    try {
      ssh = await connectSSH(safeHost, username, password);
      // Fire-and-forget reboot — the SSH connection will drop
      ssh.execCommand('sleep 1 && sudo reboot &').catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 2000));
      return { success: true };
    } catch (e: any) {
      // Connection drop during reboot is expected
      return { success: true };
    } finally {
      ssh?.dispose();
    }
  });

  // ── Unified management action router ──────────────────────────────────
  ipcMain.handle('server:manage', async (event, {
    host, username, password, action, params,
  }: {
    host: string; username: string; password: string;
    action: string; params: Record<string, any>;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'server:manage', host: safeHost, action });

    // If no password provided, check credential store for SSH key
    let sshKeyPath: string | undefined;
    let sshPassphrase: string | undefined;
    if (!password) {
      const stored = getCredentialManager().getForHost(safeHost);
      if (stored) {
        sshKeyPath = stored.sshKeyPath || undefined;
        sshPassphrase = stored.sshPassphrase || undefined;
      }
    }

    let ssh: NodeSSH | undefined;
    try {
      ssh = await connectSSH(safeHost, username, password, sshKeyPath, sshPassphrase);
      const result = await executeManageAction(ssh, action, params, jsonLogger);
      jsonLogger.info({ event: 'server:manage_done', host: safeHost, action, success: result.success });
      return result;
    } catch (e: any) {
      jsonLogger.error({ event: 'server:manage_error', host: safeHost, action, error: String(e) });
      return { success: false, error: e?.message || String(e) };
    } finally {
      ssh?.dispose();
    }
  });
}
