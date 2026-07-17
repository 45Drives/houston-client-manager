// Main process: Bulk Setup orchestrator IPC handlers
import { ipcMain, BrowserWindow } from 'electron';
import { NodeSSH } from 'node-ssh';
import fs from 'fs';
import path from 'path';
import type { Logger } from 'winston';
import { checkSSH, setupSshKey, runBootstrapScript, checkRemoteDeps } from '../setupSsh';
import { assertSafeHost, assertSafeUsername } from '../security';
import { getAgentSocket, getKeyDir, ensureKeyPair } from '../crossPlatformSsh';
import { getAsset } from '../utils';
import { loadSettings } from '../settingsStore';
import type {
  BulkServerEntry,
  BulkSetupProgress,
  BulkSetupResult,
  BulkSetupOptions,
  BulkDiskInfo,
  BulkDisk,
} from '../../shared/bulkSetupTypes';

interface BulkSetupContext {
  mainWindow: BrowserWindow;
  jsonLogger: Logger;
}

let abortController: AbortController | null = null;

function emitProgress(ctx: BulkSetupContext, progress: BulkSetupProgress) {
  if (!ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send('bulk-setup:progress', progress);
  }
}

function emitResult(ctx: BulkSetupContext, result: BulkSetupResult) {
  if (!ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send('bulk-setup:result', result);
  }
}

function emitNotification(ctx: BulkSetupContext, message: string) {
  if (!ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send('notification', message);
  }
}

/**
 * Probe a single server for disk info via SSH
 */
async function probeServerDisks(host: string, username: string, password: string): Promise<BulkDiskInfo> {
  const ssh = new NodeSSH();
  const keyDir = getKeyDir();
  const privateKeyPath = path.join(keyDir, 'id_rsa');

  try {
    await ssh.connect({
      host,
      username,
      privateKey: fs.existsSync(privateKeyPath) ? fs.readFileSync(privateKeyPath, 'utf-8') : undefined,
      password,
      readyTimeout: loadSettings().sshTimeoutMs,
    });

    // Strategy 1: Use 45Drives vdev_id.conf to identify storage-slot drives (authoritative on 45Drives hardware)
    // Entries look like: alias 1-1 /dev/disk/by-path/pci-0000:51:00.0-sas-phy0-lun-0
    const vdevResult = await ssh.execCommand(
      "test -f /etc/vdev_id.conf && grep '^alias ' /etc/vdev_id.conf | awk '{print $3}'"
    );
    const vdevFullPaths = (vdevResult.code === 0 ? vdevResult.stdout.trim().split('\n').filter(Boolean) : []);
    const hasVdevConf = vdevFullPaths.length > 0;

    // Get all block devices with details
    const lsblkResult = await ssh.execCommand(
      'lsblk -J -d -o NAME,SIZE,TYPE,MODEL,SERIAL,ROTA -e 1,7,11,253'
    );

    // Resolve vdev_id.conf paths to device names + capture alias mapping
    let aliasedDevNames = new Set<string>();
    // Map: device name → vdev alias (e.g. "sdc" → "1-1")
    let devToAlias: Record<string, string> = {};
    if (hasVdevConf) {
      // Parse aliases from vdev_id.conf: "alias 1-1 /dev/disk/by-path/..."
      const aliasParseResult = await ssh.execCommand(
        "grep '^alias ' /etc/vdev_id.conf | awk '{print $2, $3}'"
      );
      const aliasLines = aliasParseResult.code === 0 ? aliasParseResult.stdout.trim().split('\n').filter(Boolean) : [];

      // Resolve all by-path symlinks to actual device names in one command
      const resolveCmd = vdevFullPaths.map(p => `readlink -f "${p}" 2>/dev/null`).join('; ');
      const resolveResult = await ssh.execCommand(resolveCmd);
      if (resolveResult.code === 0) {
        const resolvedLines = resolveResult.stdout.trim().split('\n');
        for (let i = 0; i < resolvedLines.length && i < aliasLines.length; i++) {
          const devPath = resolvedLines[i]!.trim();
          const aliasParts = aliasLines[i]!.trim().split(/\s+/);
          const aliasName = aliasParts[0]; // e.g. "1-1"
          if (devPath.startsWith('/dev/') && aliasName) {
            const devName = devPath.replace('/dev/', '');
            aliasedDevNames.add(devName);
            devToAlias[devName] = aliasName;
          }
        }
      }
    }

    // Strategy 2 (fallback): Identify boot/OS disks by mounted root/boot/swap
    let bootDiskNames = new Set<string>();
    if (!hasVdevConf) {
      const bootDiskResult = await ssh.execCommand(
        "lsblk -n -o PKNAME,MOUNTPOINT -e 1,7,11,253 2>/dev/null | awk '$2 ~ /^\\/(boot)?$|\\[SWAP\\]/ {print $1}' | sort -u"
      );
      bootDiskNames = new Set(
        bootDiskResult.code === 0 ? bootDiskResult.stdout.trim().split('\n').filter(Boolean) : []
      );
    }

    let availableDisks: BulkDisk[] = [];
    if (lsblkResult.code === 0) {
      try {
        const parsed = JSON.parse(lsblkResult.stdout);
        const blockdevices = parsed.blockdevices || [];

        if (hasVdevConf) {
          // 45Drives hardware: only include drives that are in aliased storage slots
          availableDisks = blockdevices
            .filter((d: any) => d.type === 'disk' && aliasedDevNames.has(d.name))
            .map((d: any) => ({
              name: d.name,
              size: d.size,
              type: d.rota === '0' ? 'SSD' : d.name.startsWith('nvme') ? 'NVMe' : 'HDD',
              model: d.model?.trim() || undefined,
              serial: d.serial?.trim() || undefined,
              alias: devToAlias[d.name] || undefined,
            }));
        } else {
          // Non-45Drives: include all disks except boot/OS
          availableDisks = blockdevices
            .filter((d: any) => d.type === 'disk' && !bootDiskNames.has(d.name))
            .map((d: any) => ({
              name: d.name,
              size: d.size,
              type: d.rota === '0' ? 'SSD' : d.name.startsWith('nvme') ? 'NVMe' : 'HDD',
              model: d.model?.trim() || undefined,
              serial: d.serial?.trim() || undefined,
            }));
        }
      } catch { /* ignore parse errors */ }
    }

    // Get existing ZFS pools
    const zpoolResult = await ssh.execCommand('zpool list -H -o name 2>/dev/null');
    const existingPools = zpoolResult.code === 0
      ? zpoolResult.stdout.trim().split('\n').filter(Boolean)
      : [];

    return { availableDisks, existingPools };
  } finally {
    ssh.dispose();
  }
}

/**
 * Probe server model/chassis info
 */
async function probeServerInfo(host: string, username: string, password: string): Promise<{ serverModel?: string; chassisSize?: string }> {
  const ssh = new NodeSSH();
  const keyDir = getKeyDir();
  const privateKeyPath = path.join(keyDir, 'id_rsa');

  try {
    await ssh.connect({
      host,
      username,
      privateKey: fs.existsSync(privateKeyPath) ? fs.readFileSync(privateKeyPath, 'utf-8') : undefined,
      password,
      readyTimeout: loadSettings().sshTimeoutMs,
    });

    const result = await ssh.execCommand('cat /etc/45drives/server_info/server_info.json 2>/dev/null');
    if (result.code === 0) {
      try {
        const info = JSON.parse(result.stdout);
        return {
          serverModel: info.Model || undefined,
          chassisSize: info['Chassis Size'] || undefined,
        };
      } catch { /* ignore */ }
    }
    return {};
  } finally {
    ssh.dispose();
  }
}

/**
 * Bootstrap a single server (install deps via SSH)
 */
async function bootstrapServer(
  ctx: BulkSetupContext,
  entry: BulkServerEntry,
  signal: AbortSignal,
): Promise<{ success: boolean; reboot: boolean; error?: string }> {
  const host = assertSafeHost(entry.host);
  const username = assertSafeUsername(entry.username);

  emitProgress(ctx, {
    host, status: 'bootstrapping', step: 0, totalSteps: 10,
    label: `Checking SSH connectivity to ${host}...`,
  });

  if (signal.aborted) return { success: false, reboot: false, error: 'Cancelled' };

  // Check reachability
  const reachable = await checkSSH(host);
  if (!reachable) {
    return { success: false, reboot: false, error: `Host ${host}:22 not reachable` };
  }

  // Setup SSH key
  emitProgress(ctx, {
    host, status: 'bootstrapping', step: 1, totalSteps: 10,
    label: 'Setting up SSH key...',
  });

  let hasAuth = false;
  const agentSock = getAgentSocket();
  if (agentSock) {
    const trial = new NodeSSH();
    try {
      await trial.connect({ host, username, agent: agentSock, tryKeyboard: false });
      hasAuth = true;
    } catch { /* fall through */ } finally {
      trial.dispose();
    }
  }

  if (!hasAuth) {
    await setupSshKey(host, username, entry.password);
  }

  const keyDir = getKeyDir();
  const privateKeyPath = path.join(keyDir, 'id_rsa');
  const publicKeyPath = `${privateKeyPath}.pub`;
  await ensureKeyPair(privateKeyPath, publicKeyPath);

  if (signal.aborted) return { success: false, reboot: false, error: 'Cancelled' };

  // Check deps
  emitProgress(ctx, {
    host, status: 'bootstrapping', step: 2, totalSteps: 10,
    label: 'Checking installed dependencies...',
  });

  let needsBootstrap = true;
  try {
    const depCheck = await checkRemoteDeps(host, username, privateKeyPath);
    if (depCheck.missing.length === 0) {
      needsBootstrap = false;
    }
  } catch { /* run bootstrap anyway */ }

  if (signal.aborted) return { success: false, reboot: false, error: 'Cancelled' };

  if (!needsBootstrap) {
    emitProgress(ctx, {
      host, status: 'bootstrapping', step: 3, totalSteps: 10,
      label: 'All dependencies already installed.',
    });
    return { success: true, reboot: false };
  }

  // Run bootstrap
  emitProgress(ctx, {
    host, status: 'bootstrapping', step: 2, totalSteps: 10,
    label: 'Installing dependencies (this may take several minutes)...',
  });

  const reboot = await runBootstrapScript(host, username, privateKeyPath, entry.password, (line) => {
    if (/^\[(INFO|WARN|ERROR|BOOTSTRAP)/.test(line)) {
      emitProgress(ctx, {
        host, status: 'bootstrapping', step: 2, totalSteps: 10,
        label: line,
      });
    }
  });

  return { success: true, reboot };
}

/**
 * Run EasySetup config on a single server via SSH
 */
async function runSetupOnServer(
  ctx: BulkSetupContext,
  entry: BulkServerEntry,
  signal: AbortSignal,
): Promise<{ success: boolean; hostnameChanged?: boolean; error?: string }> {
  const host = assertSafeHost(entry.host);
  const username = assertSafeUsername(entry.username);
  const keyDir = getKeyDir();
  const privateKeyPath = path.join(keyDir, 'id_rsa');

  emitProgress(ctx, {
    host, status: 'configuring', step: 3, totalSteps: 10,
    label: 'Uploading setup configuration...',
  });

  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host,
      username,
      privateKey: fs.readFileSync(privateKeyPath, 'utf-8'),
      readyTimeout: loadSettings().sshTimeoutMs,
    });

    // Build EasySetupConfig JSON from entry
    const easyConfig = buildEasySetupConfig(entry);
    const configJson = JSON.stringify(easyConfig, null, 2);
    const remoteScriptPath = '/tmp/easysetup-bundle.js';
    const remoteConfigPath = '/tmp/bulk-setup-config.json';

    // Upload bundled CLI script (contains full EasySetupConfigurator + nodeDriver)
    const scriptLocalPath = await getAsset('static', 'easysetup-bundle.js');
    await ssh.putFile(scriptLocalPath, remoteScriptPath);
    await ssh.execCommand(`chmod +x ${remoteScriptPath}`);

    // Upload config file
    await ssh.execCommand(`cat > ${remoteConfigPath}`, { stdin: configJson });

    if (signal.aborted) return { success: false, error: 'Cancelled' };

    // Execute setup — pipe config via stdin
    emitProgress(ctx, {
      host, status: 'configuring', step: 4, totalSteps: 10,
      label: 'Running server setup...',
    });

    let hostnameChanged = false;

    const result = await ssh.execCommand(
      `node ${remoteScriptPath} < ${remoteConfigPath}`,
      {
        onStdout(chunk) {
          const lines = chunk.toString().trim().split('\n');
          for (const line of lines) {
            try {
              const progress = JSON.parse(line);
              if (progress.step !== undefined) {
                emitProgress(ctx, {
                  host,
                  status: progress.done ? 'done' : 'configuring',
                  step: Math.max(progress.step, 3), // offset from bootstrap steps
                  totalSteps: progress.total || 10,
                  label: progress.message || '',
                  hostnameChanged: progress.hostnameChanged || undefined,
                });
              }
              if (progress.hostnameChanged) {
                hostnameChanged = true;
              }
            } catch {
              // Non-JSON output, ignore
            }
          }
        },
        onStderr(chunk) {
          const text = chunk.toString().trim();
          if (text) {
            ctx.jsonLogger.warn({ event: 'bulk-setup:stderr', host, text });
          }
        },
      },
    );

    // Cleanup remote files
    await ssh.execCommand(`rm -f ${remoteScriptPath} ${remoteConfigPath}`);

    if (result.code !== 0) {
      let errorMsg = 'Setup script failed';
      // Try to parse error from stderr
      try {
        const errObj = JSON.parse(result.stderr.trim().split('\n').pop() || '{}');
        if (errObj.error) errorMsg = errObj.error;
      } catch {
        if (result.stderr.trim()) errorMsg = result.stderr.trim().slice(0, 200);
      }
      return { success: false, error: errorMsg };
    }

    // Post-setup verification
    emitProgress(ctx, {
      host, status: 'configuring', step: 9, totalSteps: 10,
      label: 'Verifying setup...',
    });

    const verification = await verifySetup(ssh, entry);
    if (!verification.success) {
      return { success: false, error: `Setup ran but verification failed: ${verification.error}` };
    }

    emitProgress(ctx, {
      host, status: 'configuring', step: 10, totalSteps: 10,
      label: `Verified: ${verification.summary}`,
    });

    return { success: true, hostnameChanged };
  } finally {
    ssh.dispose();
  }
}

/**
 * Post-setup verification: confirm hostname, Samba, ZFS, and SMB user are configured
 */
async function verifySetup(ssh: NodeSSH, entry: BulkServerEntry): Promise<{ success: boolean; error?: string; summary?: string }> {
  const checks: string[] = [];
  const failures: string[] = [];

  // Check hostname
  if (entry.serverName) {
    const hostnameResult = await ssh.execCommand('hostname');
    const actual = hostnameResult.stdout.trim();
    if (actual === entry.serverName) {
      checks.push(`hostname=${actual}`);
    } else {
      // Hostname might not apply until reboot — warn but don't fail
      checks.push(`hostname=${actual} (expected ${entry.serverName}, may need reboot)`);
    }
  }

  // Check Samba is running (smbd on Ubuntu, smb on Rocky)
  const smbdCheck = await ssh.execCommand('systemctl is-active smbd 2>/dev/null');
  const smbCheck = await ssh.execCommand('systemctl is-active smb 2>/dev/null');
  const sambaActive = smbdCheck.stdout.trim() === 'active' || smbCheck.stdout.trim() === 'active';
  if (sambaActive) {
    checks.push('samba=active');
  } else {
    failures.push('Samba service is not active');
  }

  // Check ZFS pools exist
  const pools = await ssh.execCommand('zpool list -H -o name 2>/dev/null');
  if (pools.code === 0 && pools.stdout.trim()) {
    const poolNames = pools.stdout.trim().split('\n');
    checks.push(`pools=${poolNames.join(',')}`);
  } else {
    failures.push('No ZFS pools found');
  }

  // Check SMB user exists (if configured)
  if (entry.smbUser) {
    const userCheck = await ssh.execCommand(`id "${entry.smbUser}" 2>/dev/null`);
    if (userCheck.code === 0) {
      checks.push(`user=${entry.smbUser}`);
    } else {
      failures.push(`SMB user "${entry.smbUser}" not found`);
    }
  }

  // Check share path exists
  const shareName = entry.shareName || 'share';
  const shareCheck = await ssh.execCommand(`test -d /tank/${shareName} && echo exists`);
  if (shareCheck.stdout.trim() === 'exists') {
    checks.push(`share=/tank/${shareName}`);
  } else {
    // Not a hard failure — pool might use different mountpoint
    checks.push(`share=/tank/${shareName} (not found, may use different path)`);
  }

  if (failures.length > 0) {
    return { success: false, error: failures.join('; ') };
  }

  return { success: true, summary: checks.join(' · ') };
}

/**
 * Build an EasySetupConfig JSON from a BulkServerEntry
 */
function buildEasySetupConfig(entry: BulkServerEntry): Record<string, any> {
  if (entry.mode === 'custom' && entry.customConfig) {
    return {
      ...entry.customConfig,
      srvrName: entry.customConfig.srvrName || entry.serverName,
      smbUser: entry.customConfig.smbUser || entry.smbUser,
      smbPass: entry.customConfig.smbPass || entry.smbPass,
    };
  }

  const shareName = entry.shareName || 'share';
  const poolName = 'tank';

  // Build VDev disks from probed disk info
  // Boot/OS disks are already filtered out during probe, but guard against edge cases
  const allDisks = (entry.diskInfo?.availableDisks || []);
  const disks = allDisks.map(d => ({
    // Use /dev/disk/by-vdev/<alias> for 45Drives hardware (shows slot names in zpool status)
    // Falls back to /dev/<name> for non-45Drives systems
    path: d.alias ? `/dev/disk/by-vdev/${d.alias}` : `/dev/${d.name}`,
    name: d.alias || d.name,
    sd_path: `/dev/${d.name}`,
    vdev_path: d.alias ? `/dev/disk/by-vdev/${d.alias}` : undefined,
    capacity: d.size,
    model: d.model,
    serial: d.serial,
    type: d.type,
  }));

  if (disks.length === 0) {
    throw new Error(`No suitable disks found on ${entry.host}. Probe returned ${allDisks.length} disk(s) but none are eligible for ZFS pool creation.`);
  }

  const useSplitPools = entry.splitPools === true && disks.length >= 4;

  // Split disks for active backup mode
  let storageDisks = disks;
  let backupDisks: typeof disks = [];
  if (useSplitPools) {
    const half = Math.ceil(disks.length / 2);
    storageDisks = disks.slice(0, half);
    backupDisks = disks.slice(half);
  }

  // Pick RAID level based on disk count
  function pickRaid(count: number): string {
    if (count >= 6) return 'raidz2';
    if (count >= 3) return 'raidz1';
    if (count === 2) return 'mirror';
    return 'disk';
  }

  const storageRaid = pickRaid(storageDisks.length);
  const backupRaid = pickRaid(backupDisks.length);

  // Simple mode: build full config matching EasySetupConfigurator's expectations
  return {
    srvrName: entry.serverName,
    folderName: shareName,
    smbUser: entry.smbUser,
    smbPass: entry.smbPass,
    splitPools: useSplitPools,
    skipClearExisting: !entry.clearExistingData,
    zfsConfigs: [
      {
        pool: {
          name: poolName,
          vdevs: [{ type: storageRaid, disks: storageDisks }],
        },
        poolOptions: {
          autoexpand: 'on',
          autoreplace: 'on',
          autotrim: 'on',
          compression: 'lz4',
          forceCreate: true,
        },
        dataset: { name: shareName },
        datasetOptions: {
          compression: 'lz4',
          atime: 'off',
        },
      },
      {
        pool: {
          name: `${poolName}-backup`,
          vdevs: useSplitPools
            ? [{ type: backupRaid, disks: backupDisks }]
            : [{ type: 'disk', disks: [] }],
        },
        poolOptions: useSplitPools ? {
          autoexpand: 'on',
          autoreplace: 'on',
          autotrim: 'on',
          compression: 'lz4',
          forceCreate: true,
        } : {},
        dataset: { name: useSplitPools ? shareName : 'backup' },
        datasetOptions: useSplitPools ? {
          compression: 'lz4',
          atime: 'off',
        } : {},
      },
    ],
    sambaConfig: {
      global: {
        serverString: 'Samba %v',
        logLevel: 0,
        workgroup: 'WORKGROUP',
        advancedOptions: {},
      },
      shares: [
        {
          name: shareName,
          description: '',
          path: `/${poolName}/${shareName}`,
          guestOk: false,
          browseable: true,
          readOnly: false,
          inheritPermissions: true,
          advancedOptions: {},
        },
      ],
    },
    serverConfig: {
      adminUser: entry.username,
      adminPass: entry.password,
      disableRootSSH: false, // Keep SSH access for future management
      newRootPass: entry.useSameRootPass === false && entry.rootPass
        ? entry.rootPass
        : entry.smbPass, // SSS default: same password for root
      useNTP: true,
    },
    usersAndGroups: {
      users: [
        {
          username: entry.smbUser,
          password: entry.smbPass,
          groups: ['smbusers'],
        },
      ],
      groups: [{ name: 'smbusers' }],
    },
  };
}

/**
 * Run the full bulk setup pipeline for one server
 */
async function setupSingleServer(
  ctx: BulkSetupContext,
  entry: BulkServerEntry,
  signal: AbortSignal,
): Promise<BulkSetupResult> {
  const host = entry.host;
  const startTime = Date.now();
  const serverLabel = entry.serverName || host;

  try {
    emitNotification(ctx, `🔧 Starting setup for ${serverLabel}...`);

    // Phase 1: Bootstrap
    const bootstrap = await bootstrapServer(ctx, entry, signal);
    if (!bootstrap.success) {
      emitProgress(ctx, { host, status: 'failed', step: 0, totalSteps: 10, label: '', error: bootstrap.error });
      emitNotification(ctx, `❌ ${serverLabel}: Bootstrap failed — ${bootstrap.error}`);
      return { host, success: false, error: bootstrap.error };
    }

    if (bootstrap.reboot) {
      // Wait for server to come back after reboot
      emitProgress(ctx, { host, status: 'bootstrapping', step: 2, totalSteps: 10, label: 'Server is rebooting... waiting for it to come back online.' });
      emitNotification(ctx, `🔄 ${serverLabel}: Rebooting (ZFS kernel modules installed)...`);
      const startWait = Date.now();
      const maxWait = 180_000; // 3 minutes
      while (Date.now() - startWait < maxWait) {
        if (signal.aborted) return { host, success: false, error: 'Cancelled' };
        await new Promise(r => setTimeout(r, 5000));
        const elapsed = Math.round((Date.now() - startWait) / 1000);
        emitProgress(ctx, { host, status: 'bootstrapping', step: 2, totalSteps: 10, label: `Waiting for reboot... (${elapsed}s elapsed)` });
        if (await checkSSH(host, 3000)) break;
      }
      if (!(await checkSSH(host, 3000))) {
        const err = 'Server did not come back after reboot within 3 minutes';
        emitProgress(ctx, { host, status: 'failed', step: 2, totalSteps: 10, label: '', error: err });
        emitNotification(ctx, `❌ ${serverLabel}: Reboot timeout — server unreachable after 3 minutes`);
        return { host, success: false, error: err };
      }
    }

    if (signal.aborted) return { host, success: false, error: 'Cancelled' };

    // Phase 2: Run setup
    const setup = await runSetupOnServer(ctx, entry, signal);
    if (!setup.success) {
      emitProgress(ctx, { host, status: 'failed', step: 0, totalSteps: 10, label: '', error: setup.error });
      emitNotification(ctx, `❌ ${serverLabel}: Setup failed — ${setup.error}`);
      return { host, success: false, error: setup.error };
    }

    // Phase 3: Reboot if hostname was changed (required for mDNS/avahi/samba to pick up new name)
    if (setup.hostnameChanged) {
      emitProgress(ctx, { host, status: 'configuring', step: 9, totalSteps: 10, label: `Rebooting to apply new hostname (${entry.serverName})...` });
      emitNotification(ctx, `🔄 ${serverLabel}: Rebooting to apply hostname change...`);

      const ssh2 = new NodeSSH();
      try {
        await ssh2.connect({
          host,
          username: assertSafeUsername(entry.username),
          privateKey: fs.readFileSync(path.join(getKeyDir(), 'id_rsa'), 'utf-8'),
          readyTimeout: loadSettings().sshTimeoutMs,
        });
        await ssh2.execCommand('reboot');
        ssh2.dispose();
      } catch (e: any) {
        // reboot command may close connection before we get a response — that's fine
        ctx.jsonLogger.warn({ event: 'bulk-setup:reboot-send', host, error: String(e) });
        try { ssh2.dispose(); } catch {}
      }

      // Wait for server to go offline then come back
      emitProgress(ctx, { host, status: 'configuring', step: 9, totalSteps: 10, label: 'Server is offline for reboot...' });
      await new Promise(r => setTimeout(r, 10000)); // initial wait for shutdown

      const startWait = Date.now();
      const maxWait = 180_000;
      let cameBack = false;
      while (Date.now() - startWait < maxWait) {
        if (signal.aborted) return { host, success: false, error: 'Cancelled' };
        await new Promise(r => setTimeout(r, 5000));
        const elapsed = Math.round((Date.now() - startWait) / 1000);
        emitProgress(ctx, { host, status: 'configuring', step: 9, totalSteps: 10, label: `Waiting for reboot... (${elapsed}s)` });
        if (await checkSSH(host, 3000)) {
          cameBack = true;
          break;
        }
      }

      if (cameBack) {
        emitProgress(ctx, { host, status: 'configuring', step: 9, totalSteps: 10, label: `Server is back online with hostname "${entry.serverName}"` });
        emitNotification(ctx, `✅ ${serverLabel}: Back online after hostname reboot`);
      } else {
        emitProgress(ctx, { host, status: 'configuring', step: 9, totalSteps: 10, label: `⚠ Server did not come back after reboot within 3 minutes` });
        emitNotification(ctx, `⚠️ ${serverLabel}: Setup done but server didn't come back after hostname reboot`);
        // Don't fail — setup was successful, just reboot timeout
      }
    }

    const duration = Date.now() - startTime;
    const summary = [
      entry.serverName ? `Hostname: ${entry.serverName}` : null,
      `Pool: tank (${entry.diskInfo?.availableDisks?.length || '?'} disks)`,
      `Share: ${entry.shareName || 'share'}`,
      `SMB User: ${entry.smbUser}`,
      setup.hostnameChanged ? 'Rebooted for hostname change' : null,
    ].filter(Boolean).join(' · ');

    emitProgress(ctx, { host, status: 'done', step: 10, totalSteps: 10, label: 'Setup complete and verified!' });
    emitNotification(ctx, `✅ ${serverLabel}: Setup complete (${Math.round(duration / 1000)}s)`);
    return {
      host,
      success: true,
      durationMs: duration,
      summary,
      finalHostname: entry.serverName || undefined,
      reboot: setup.hostnameChanged,
    };
  } catch (err: any) {
    const error = err?.message || String(err);
    ctx.jsonLogger.error({ event: 'bulk-setup:server-error', host, error });
    emitProgress(ctx, { host, status: 'failed', step: 0, totalSteps: 10, label: '', error });
    emitNotification(ctx, `❌ ${serverLabel}: ${error}`);
    return { host, success: false, error, durationMs: Date.now() - startTime };
  }
}

/**
 * Register all bulk setup IPC handlers
 */
export function registerBulkSetupHandlers(ctx: BulkSetupContext) {
  const { mainWindow, jsonLogger } = ctx;

  // Validate: probe SSH reachability for all servers
  ipcMain.handle('bulk-setup:validate', async (event, servers: Array<{ host: string; username: string; password: string }>) => {
    const results: Array<{ host: string; reachable: boolean; isAdmin?: boolean; error?: string }> = [];

    for (const srv of servers) {
      try {
        const host = assertSafeHost(srv.host);
        const reachable = await checkSSH(host, 5000);
        if (!reachable) {
          results.push({ host, reachable: false, error: 'SSH port 22 not reachable' });
          continue;
        }

        // Quick credential check
        const ssh = new NodeSSH();
        try {
          await ssh.connect({
            host,
            username: srv.username,
            password: srv.password,
            readyTimeout: 10000,
          });
          const uidResult = await ssh.execCommand('id -u');
          const isAdmin = uidResult.stdout.trim() === '0';
          results.push({ host, reachable: true, isAdmin });
        } catch (e: any) {
          results.push({ host, reachable: true, error: e?.message || 'Auth failed' });
        } finally {
          ssh.dispose();
        }
      } catch (e: any) {
        results.push({ host: srv.host, reachable: false, error: e?.message });
      }
    }
    return results;
  });

  // Probe: get disk info and server model for all servers
  ipcMain.handle('bulk-setup:probe', async (event, servers: Array<{ host: string; username: string; password: string }>) => {
    const results: Array<{ host: string; diskInfo?: BulkDiskInfo; serverModel?: string; chassisSize?: string; error?: string }> = [];

    await Promise.allSettled(servers.map(async (srv) => {
      try {
        const host = assertSafeHost(srv.host);
        const [diskInfo, serverInfo] = await Promise.all([
          probeServerDisks(host, srv.username, srv.password),
          probeServerInfo(host, srv.username, srv.password),
        ]);
        results.push({ host, diskInfo, ...serverInfo });
      } catch (e: any) {
        results.push({ host: srv.host, error: e?.message || 'Probe failed' });
      }
    }));

    return results;
  });

  // Run: execute the full bulk setup pipeline
  ipcMain.handle('bulk-setup:run', async (event, entries: BulkServerEntry[], options?: BulkSetupOptions) => {
    abortController = new AbortController();
    const signal = abortController.signal;
    const parallel = options?.parallel ?? false;
    const maxConcurrency = options?.maxConcurrency ?? 3;

    jsonLogger.info({ event: 'bulk-setup:start', serverCount: entries.length, parallel });

    const results: BulkSetupResult[] = [];

    if (parallel) {
      // Process in batches of maxConcurrency
      for (let i = 0; i < entries.length; i += maxConcurrency) {
        if (signal.aborted) break;
        const batch = entries.slice(i, i + maxConcurrency);
        const batchResults = await Promise.allSettled(
          batch.map(entry => setupSingleServer(ctx, entry, signal))
        );
        for (const r of batchResults) {
          results.push(r.status === 'fulfilled' ? r.value : { host: 'unknown', success: false, error: 'Unexpected error' });
        }
      }
    } else {
      // Sequential
      for (const entry of entries) {
        if (signal.aborted) break;
        const result = await setupSingleServer(ctx, entry, signal);
        results.push(result);
        emitResult(ctx, result);
      }
    }

    const summary = {
      total: entries.length,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    };

    jsonLogger.info({ event: 'bulk-setup:complete', ...summary });
    mainWindow.webContents.send('bulk-setup:complete', summary);

    // Summary notification
    if (summary.failed === 0) {
      emitNotification(ctx, `🎉 Bulk setup complete: all ${summary.total} servers configured successfully!`);
    } else {
      emitNotification(ctx, `⚠️ Bulk setup done: ${summary.success}/${summary.total} succeeded, ${summary.failed} failed.`);
    }

    abortController = null;
    return summary;
  });

  // Cancel in-flight bulk setup
  ipcMain.handle('bulk-setup:cancel', async () => {
    if (abortController) {
      abortController.abort();
      jsonLogger.info({ event: 'bulk-setup:cancel' });
      return { ok: true };
    }
    return { ok: false, error: 'No bulk setup in progress' };
  });
}
