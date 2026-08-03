// Main process: Wire Wizard IPC handlers
// Executes wire-wizard scripts on remote servers via SSH for VPN tunnel management.
import { ipcMain } from 'electron';
import { NodeSSH } from 'node-ssh';
import type { Logger } from 'winston';
import { assertSafeHost, assertSafeUsername } from '../security';
import { connectWithFallback, type SshAuth } from '../setupSsh';
import { getCredentialManager } from '../credentialManager';

interface WireWizardContext {
  jsonLogger: Logger;
}

const SCRIPTS = '/usr/lib/wire-wizard';

// ── SSH Connection Pool ────────────────────────────────────────────────────
// Reuses a single SSH connection per host to avoid repeated handshake overhead.
// Connections auto-close after 60s of inactivity.

interface PoolEntry {
  ssh: NodeSSH;
  timer: ReturnType<typeof setTimeout>;
  host: string;
  username: string;
}

const sshPool = new Map<string, PoolEntry>();
const POOL_IDLE_MS = 60_000; // close after 60s idle

function poolKey(host: string, username: string): string {
  return `${username}@${host}`;
}

function disposePoolEntry(key: string) {
  const entry = sshPool.get(key);
  if (entry) {
    clearTimeout(entry.timer);
    try { entry.ssh.dispose(); } catch {}
    sshPool.delete(key);
  }
}

async function getPooledSSH(host: string, username: string, password?: string): Promise<NodeSSH> {
  const key = poolKey(host, username);
  const existing = sshPool.get(key);

  // Reuse if connected
  if (existing && existing.ssh.isConnected()) {
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => disposePoolEntry(key), POOL_IDLE_MS);
    return existing.ssh;
  }

  // Clean up stale entry
  if (existing) {
    disposePoolEntry(key);
  }

  // Create new connection
  const ssh = await connectSSH(host, username, password);
  const timer = setTimeout(() => disposePoolEntry(key), POOL_IDLE_MS);
  sshPool.set(key, { ssh, timer, host, username });
  return ssh;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function connectSSH(host: string, username: string, password?: string): Promise<NodeSSH> {
  if (!password) {
    const stored = getCredentialManager().getForHost(host);
    if (stored?.sshKeyPath) {
      return connectWithFallback(host, { username, method: 'key', privateKeyPath: stored.sshKeyPath, passphrase: stored.sshPassphrase || undefined });
    }
  }
  return connectWithFallback(host, { username, method: 'password', password: password || '' });
}

async function cmd(ssh: NodeSSH, command: string): Promise<string> {
  const result = await ssh.execCommand(command);
  if (result.code !== 0 && result.stderr) {
    throw new Error(result.stderr);
  }
  return result.stdout.trim();
}

async function sudoCmd(ssh: NodeSSH, command: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const result = await ssh.execCommand(`sudo ${command} 2>&1`);
  return { code: result.code, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface WireWizardTunnel {
  name: string;
  publicKey: string;
  listenPort: number;
  peers: Array<{
    publicKey: string;
    endpoint: string;
    allowedIPs: string;
    latestHandshake: number;
    transferRx: number;
    transferTx: number;
    keepalive: number;
  }>;
}

export interface WireWizardStatus {
  installed: boolean;
  configured: boolean;
  interfaces: WireWizardTunnel[];
}

export interface PairInitiateResult {
  code: string;
  endpoint: string;
  port: string;
}

export interface PairCompleteResult {
  status: string;
  interface: string;
  address: string;
  listenPort: string;
  peerEndpoint: string;
}

// ── Registration ───────────────────────────────────────────────────────────

export function registerWireWizardHandlers(ctx: WireWizardContext) {
  const { jsonLogger } = ctx;

  // Check if wire-wizard is installed on a remote server
  ipcMain.handle('wirewizard:status', async (_event, { host, username, password }: { host: string; username: string; password?: string }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'wirewizard:status', host: safeHost });

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      // Check if scripts exist
      const installed = await ssh.execCommand(`test -f ${SCRIPTS}/status.sh`);
      if (installed.code !== 0) {
        return { success: true, data: { installed: false, configured: false, interfaces: [] } as WireWizardStatus };
      }

      // Check if config exists
      const configCheck = await ssh.execCommand('test -f /etc/wire-wizard/config.json');
      const configured = configCheck.code === 0;

      // Get tunnel status
      const statusResult = await ssh.execCommand(`sudo bash ${SCRIPTS}/status.sh`);
      let interfaces: WireWizardTunnel[] = [];
      if (statusResult.code === 0 && statusResult.stdout.trim()) {
        try {
          const parsed = JSON.parse(statusResult.stdout.trim());
          interfaces = parsed.interfaces || [];
        } catch { /* parse error — return empty */ }
      }

      return { success: true, data: { installed: true, configured, interfaces } as WireWizardStatus };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username)); // drop broken connection
      jsonLogger.error({ event: 'wirewizard:status_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Initiate pairing on a remote server (generates code)
  ipcMain.handle('wirewizard:initiate', async (_event, { host, username, password, name, ttl, port, endpoint }: {
    host: string; username: string; password?: string; name?: string; ttl?: number; port?: number; endpoint?: string;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'wirewizard:initiate', host: safeHost, name });

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      let args = `sudo bash ${SCRIPTS}/pair-initiate.sh --json`;
      if (name) args += ` --name ${shellQuote(name)}`;
      if (ttl) args += ` --ttl ${Number(ttl)}`;
      if (port) args += ` --port ${Number(port)}`;
      if (endpoint) args += ` --endpoint ${shellQuote(endpoint)}`;

      const result = await ssh.execCommand(args);
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'pair-initiate failed');
      }

      const data = JSON.parse(result.stdout.trim()) as PairInitiateResult;
      jsonLogger.info({ event: 'wirewizard:initiate_success', host: safeHost, code: data.code });
      return { success: true, data };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'wirewizard:initiate_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Join a pairing on a remote server (claims code, configures tunnel)
  ipcMain.handle('wirewizard:join', async (_event, { host, username, password, code, name, port, endpoint }: {
    host: string; username: string; password?: string; code: string; name?: string; port?: number; endpoint?: string;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'wirewizard:join', host: safeHost });

    if (!code || code.length !== 6) {
      return { success: false, error: 'Invalid pairing code' };
    }

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      let args = `sudo bash ${SCRIPTS}/pair-join.sh ${shellQuote(code.toUpperCase())} --json`;
      if (name) args += ` --name ${shellQuote(name)}`;
      if (port) args += ` --port ${Number(port)}`;
      if (endpoint) args += ` --endpoint ${shellQuote(endpoint)}`;

      const result = await ssh.execCommand(args);
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'pair-join failed');
      }

      const data = JSON.parse(result.stdout.trim()) as PairCompleteResult;
      jsonLogger.info({ event: 'wirewizard:join_success', host: safeHost, iface: data.interface });
      return { success: true, data };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'wirewizard:join_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Poll pairing status from a remote server (for initiator waiting for joiner)
  ipcMain.handle('wirewizard:poll', async (_event, { host, username, password, code }: {
    host: string; username: string; password?: string; code: string;
  }) => {
    const safeHost = assertSafeHost(host);

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      // Use curl on the server to poll the VPS (server has config with API key)
      const result = await ssh.execCommand(
        `sudo bash -c 'source ${SCRIPTS}/common.sh && load_config && api_call GET "/api/pair/poll/${shellQuote(code)}"'`
      );
      if (result.code !== 0) {
        throw new Error(result.stderr || 'poll failed');
      }

      const data = JSON.parse(result.stdout.trim());
      return { success: true, data };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      return { success: false, error: e?.message };
    }
  });

  // Complete the initiator side after joiner has claimed the code
  ipcMain.handle('wirewizard:complete', async (_event, { host, username, password, code, peerPubkey, peerEndpoint, peerLocalEndpoint, peerNatEndpoint }: {
    host: string; username: string; password?: string; code: string;
    peerPubkey: string; peerEndpoint: string; peerLocalEndpoint?: string; peerNatEndpoint?: string;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'wirewizard:complete', host: safeHost });

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      let args = `sudo bash ${SCRIPTS}/pair-complete.sh ${shellQuote(code)} --json`;
      args += ` --peer-pubkey ${shellQuote(peerPubkey)}`;
      args += ` --peer-endpoint ${shellQuote(peerEndpoint)}`;
      if (peerLocalEndpoint) args += ` --peer-local-endpoint ${shellQuote(peerLocalEndpoint)}`;
      if (peerNatEndpoint) args += ` --peer-nat-endpoint ${shellQuote(peerNatEndpoint)}`;

      const result = await ssh.execCommand(args);
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'pair-complete failed');
      }

      const data = JSON.parse(result.stdout.trim()) as PairCompleteResult;
      jsonLogger.info({ event: 'wirewizard:complete_success', host: safeHost, iface: data.interface });
      return { success: true, data };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'wirewizard:complete_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Tear down a tunnel on a remote server
  ipcMain.handle('wirewizard:teardown', async (_event, { host, username, password, iface }: {
    host: string; username: string; password?: string; iface: string;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'wirewizard:teardown', host: safeHost, iface });

    if (!iface || !/^wg-/.test(iface)) {
      return { success: false, error: 'Invalid interface name' };
    }

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      const result = await ssh.execCommand(`sudo bash ${SCRIPTS}/teardown.sh ${shellQuote(iface)} --json`);
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'teardown failed');
      }

      jsonLogger.info({ event: 'wirewizard:teardown_success', host: safeHost, iface });
      return { success: true };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'wirewizard:teardown_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Run preflight check (verify tunnel health before backup)
  ipcMain.handle('wirewizard:preflight', async (_event, { host, username, password, iface }: {
    host: string; username: string; password?: string; iface?: string;
  }) => {
    const safeHost = assertSafeHost(host);

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      let args = `sudo bash ${SCRIPTS}/preflight.sh`;
      if (iface) args += ` --interface ${shellQuote(iface)}`;

      const result = await ssh.execCommand(args);
      return {
        success: true,
        data: { healthy: result.code === 0, output: result.stdout.trim(), error: result.stderr.trim() },
      };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      return { success: false, error: e?.message };
    }
  });

  // Restart a tunnel on a remote server
  ipcMain.handle('wirewizard:restart', async (_event, { host, username, password, iface }: {
    host: string; username: string; password?: string; iface: string;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'wirewizard:restart', host: safeHost, iface });

    if (!iface || !/^wg-/.test(iface)) {
      return { success: false, error: 'Invalid interface name' };
    }

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      const result = await ssh.execCommand(`sudo bash ${SCRIPTS}/restart.sh ${shellQuote(iface)} --json`);
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'restart failed');
      }

      const data = JSON.parse(result.stdout.trim());
      jsonLogger.info({ event: 'wirewizard:restart_success', host: safeHost, iface });
      return { success: true, data };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'wirewizard:restart_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Add a peer to an existing interface
  ipcMain.handle('wirewizard:addPeer', async (_event, { host, username, password, iface, pubkey, endpoint, allowedIPs, keepalive }: {
    host: string; username: string; password?: string; iface: string;
    pubkey: string; endpoint?: string; allowedIPs?: string; keepalive?: number;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'wirewizard:addPeer', host: safeHost, iface });

    if (!iface || !/^wg-/.test(iface)) {
      return { success: false, error: 'Invalid interface name' };
    }

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      let args = `sudo bash ${SCRIPTS}/add-peer.sh --interface ${shellQuote(iface)} --pubkey ${shellQuote(pubkey)} --json`;
      if (endpoint) args += ` --endpoint ${shellQuote(endpoint)}`;
      if (allowedIPs) args += ` --allowed-ips ${shellQuote(allowedIPs)}`;
      if (keepalive) args += ` --keepalive ${Number(keepalive)}`;

      const result = await ssh.execCommand(args);
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'add-peer failed');
      }

      jsonLogger.info({ event: 'wirewizard:addPeer_success', host: safeHost, iface });
      return { success: true, data: JSON.parse(result.stdout.trim()) };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'wirewizard:addPeer_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Edit an existing peer
  ipcMain.handle('wirewizard:editPeer', async (_event, { host, username, password, iface, pubkey, endpoint, allowedIPs, keepalive }: {
    host: string; username: string; password?: string; iface: string;
    pubkey: string; endpoint?: string; allowedIPs?: string; keepalive?: number;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'wirewizard:editPeer', host: safeHost, iface });

    if (!iface || !/^wg-/.test(iface)) {
      return { success: false, error: 'Invalid interface name' };
    }

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      let args = `sudo bash ${SCRIPTS}/edit-peer.sh --interface ${shellQuote(iface)} --pubkey ${shellQuote(pubkey)} --json`;
      if (endpoint) args += ` --endpoint ${shellQuote(endpoint)}`;
      if (allowedIPs) args += ` --allowed-ips ${shellQuote(allowedIPs)}`;
      if (keepalive !== undefined) args += ` --keepalive ${Number(keepalive)}`;

      const result = await ssh.execCommand(args);
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'edit-peer failed');
      }

      jsonLogger.info({ event: 'wirewizard:editPeer_success', host: safeHost, iface });
      return { success: true, data: JSON.parse(result.stdout.trim()) };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'wirewizard:editPeer_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Remove a peer from an interface
  ipcMain.handle('wirewizard:removePeer', async (_event, { host, username, password, iface, pubkey }: {
    host: string; username: string; password?: string; iface: string; pubkey: string;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'wirewizard:removePeer', host: safeHost, iface });

    if (!iface || !/^wg-/.test(iface)) {
      return { success: false, error: 'Invalid interface name' };
    }

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      const args = `sudo bash ${SCRIPTS}/remove-peer.sh --interface ${shellQuote(iface)} --pubkey ${shellQuote(pubkey)} --teardown-empty --json`;

      const result = await ssh.execCommand(args);
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'remove-peer failed');
      }

      jsonLogger.info({ event: 'wirewizard:removePeer_success', host: safeHost, iface });
      return { success: true };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'wirewizard:removePeer_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Invite a peer to an existing tunnel (generates invite code)
  ipcMain.handle('wirewizard:invite', async (_event, { host, username, password, iface, ttl }: {
    host: string; username: string; password?: string; iface: string; ttl?: number;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'wirewizard:invite', host: safeHost, iface });

    if (!iface || !/^wg-/.test(iface)) {
      return { success: false, error: 'Invalid interface name' };
    }

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      let args = `sudo bash ${SCRIPTS}/invite-peer.sh --interface ${shellQuote(iface)} --json`;
      if (ttl) args += ` --ttl ${Number(ttl)}`;

      const result = await ssh.execCommand(args);
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'invite-peer failed');
      }

      const data = JSON.parse(result.stdout.trim());
      jsonLogger.info({ event: 'wirewizard:invite_success', host: safeHost, iface, code: data.code });
      return { success: true, data };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'wirewizard:invite_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Complete an invite (add the new peer to existing interface)
  ipcMain.handle('wirewizard:inviteComplete', async (_event, { host, username, password, code, peerPubkey, peerEndpoint, peerLocalEndpoint, peerNatEndpoint }: {
    host: string; username: string; password?: string; code: string;
    peerPubkey: string; peerEndpoint: string; peerLocalEndpoint?: string; peerNatEndpoint?: string;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'wirewizard:inviteComplete', host: safeHost });

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      let args = `sudo bash ${SCRIPTS}/invite-complete.sh ${shellQuote(code)} --json`;
      args += ` --peer-pubkey ${shellQuote(peerPubkey)}`;
      args += ` --peer-endpoint ${shellQuote(peerEndpoint)}`;
      if (peerLocalEndpoint) args += ` --peer-local-endpoint ${shellQuote(peerLocalEndpoint)}`;
      if (peerNatEndpoint) args += ` --peer-nat-endpoint ${shellQuote(peerNatEndpoint)}`;

      const result = await ssh.execCommand(args);
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'invite-complete failed');
      }

      const data = JSON.parse(result.stdout.trim());
      jsonLogger.info({ event: 'wirewizard:inviteComplete_success', host: safeHost });
      return { success: true, data };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'wirewizard:inviteComplete_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });
}
