// Main process: WireShield IPC handlers
// Drives tunnel pairing and management on remote servers over SSH, using the
// wireshield-pair CLI and the WireShield API that ships with the package.
import { ipcMain } from 'electron';
import { NodeSSH } from 'node-ssh';
import type { Logger } from 'winston';
import { assertSafeHost, assertSafeUsername } from '../security';
import { connectWithFallback, type SshAuth } from '../setupSsh';
import { getCredentialManager } from '../credentialManager';

interface WireShieldContext {
  jsonLogger: Logger;
}

const WIRESHIELD_CLI = '/usr/sbin/wireshield-pair';
const API_ENV = '/etc/wireshield/api.env';

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

// Talks to the WireShield API on the server itself so the API key never leaves it.
async function apiCall(
  ssh: NodeSSH,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<any> {
  const curl = [
    'curl -sk --max-time 60',
    `-X ${method}`,
    '-H "Content-Type: application/json"',
    '-H "X-API-Key: $HNE_API_KEY"',
    '-H "X-Audit-Source: houston-client-manager"',
    "-w '\\n%{http_code}'",
    body === undefined ? '' : `-d ${shellQuote(JSON.stringify(body))}`,
    '"https://127.0.0.1:${HNE_PORT:-8420}/api/v1' + path + '"',
  ].filter(Boolean).join(' ');

  const script = `set -a; . ${API_ENV}; set +a; ${curl}`;
  const result = await ssh.execCommand(`sudo bash -c ${shellQuote(script)}`);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `WireShield API request failed (${method} ${path})`);
  }

  const out = result.stdout.trim();
  const split = out.lastIndexOf('\n');
  const httpCode = Number(split === -1 ? out : out.slice(split + 1));
  const rawBody = split === -1 ? '' : out.slice(0, split).trim();

  let parsed: any = null;
  if (rawBody) {
    try { parsed = JSON.parse(rawBody); } catch { /* non-JSON body */ }
  }

  if (!Number.isFinite(httpCode) || httpCode < 200 || httpCode >= 300) {
    throw new Error(parsed?.detail || `WireShield API returned HTTP ${httpCode || 'error'}`);
  }
  return parsed;
}

function handshakeEpoch(value?: string | null): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

async function listPairedConnections(ssh: NodeSSH): Promise<any[]> {
  const paired = await apiCall(ssh, 'GET', '/pairing/connections');
  return paired?.connections ?? [];
}

async function resolveNetworkId(ssh: NodeSSH, iface: string): Promise<string> {
  const match = (await listPairedConnections(ssh)).find((c: any) => c?.interface === iface);
  if (!match?.network_id) {
    throw new Error(`No paired tunnel named '${iface}' on this server`);
  }
  return match.network_id;
}

async function resolvePeerId(ssh: NodeSSH, networkId: string, pubkey: string): Promise<string> {
  const peerList = await apiCall(ssh, 'GET', `/networks/${encodeURIComponent(networkId)}/peers`);
  const match = (peerList?.peers ?? []).find((p: any) => p?.public_key === pubkey);
  if (!match?.id) {
    throw new Error('Peer not found on this tunnel');
  }
  return match.id;
}

async function fetchTunnels(ssh: NodeSSH): Promise<WireShieldTunnel[]> {
  const ifaceByNetwork = new Map<string, string>();
  for (const row of await listPairedConnections(ssh)) {
    if (row?.network_id && !ifaceByNetwork.has(row.network_id)) {
      ifaceByNetwork.set(row.network_id, row.interface);
    }
  }
  if (!ifaceByNetwork.size) return [];

  const networks = await apiCall(ssh, 'GET', '/networks');
  const byId = new Map<string, any>();
  for (const net of networks?.networks ?? []) byId.set(net.id, net);

  const tunnels: WireShieldTunnel[] = [];
  for (const [networkId, iface] of ifaceByNetwork) {
    const net = byId.get(networkId);
    const peerList = await apiCall(ssh, 'GET', `/networks/${encodeURIComponent(networkId)}/peers`);
    tunnels.push({
      name: iface,
      publicKey: net?.public_key || '',
      listenPort: Number(net?.listen_port) || 0,
      peers: (peerList?.peers ?? []).map((p: any) => ({
        publicKey: p.public_key || '',
        endpoint: p.endpoint || '',
        allowedIPs: p.custom_allowed_ips || p.allowed_ips || '',
        latestHandshake: handshakeEpoch(p.last_handshake_at),
        transferRx: Number(p.bytes_rx) || 0,
        transferTx: Number(p.bytes_tx) || 0,
        keepalive: 0,
      })),
    });
  }
  return tunnels;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface WireShieldTunnel {
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

export interface WireShieldStatus {
  installed: boolean;
  configured: boolean;
  interfaces: WireShieldTunnel[];
}

export interface PairInitiateResult {
  code: string;
  endpoint: string;
  port: string;
  interface?: string;
}

export interface PairCompleteResult {
  status: string;
  interface: string;
  address: string;
  listenPort: string;
  peerEndpoint: string;
}

// ── Registration ───────────────────────────────────────────────────────────

export function registerWireShieldHandlers(ctx: WireShieldContext) {
  const { jsonLogger } = ctx;

  // Check if wireshield is installed on a remote server
  ipcMain.handle('WireShield:status', async (_event, { host, username, password }: { host: string; username: string; password?: string }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'WireShield:status', host: safeHost });

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      const installed = await ssh.execCommand(`test -x ${WIRESHIELD_CLI}`);
      if (installed.code !== 0) {
        return { success: true, data: { installed: false, configured: false, interfaces: [] } as WireShieldStatus };
      }

      const configCheck = await ssh.execCommand(`sudo test -f ${API_ENV}`);
      const configured = configCheck.code === 0;
      const interfaces = configured ? await fetchTunnels(ssh) : [];

      return { success: true, data: { installed: true, configured, interfaces } as WireShieldStatus };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username)); // drop broken connection
      jsonLogger.error({ event: 'WireShield:status_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Initiate pairing on a remote server (generates code)
  ipcMain.handle('WireShield:initiate', async (_event, { host, username, password, name, ttl, port, endpoint }: {
    host: string; username: string; password?: string; name?: string; ttl?: number; port?: number; endpoint?: string;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'WireShield:initiate', host: safeHost, name });

    try {
      const ssh = await getPooledSSH(safeHost, username, password);

      let cli = `sudo ${WIRESHIELD_CLI} create --json --no-wait`;
      if (name) cli += ` --name ${shellQuote(name)}`;
      if (ttl) cli += ` --ttl ${Number(ttl)}`;
      if (port) cli += ` --port ${Number(port)}`;
      if (endpoint) cli += ` --endpoint ${shellQuote(endpoint)}`;

      const cliResult = await ssh.execCommand(cli);
      if (cliResult.code !== 0) {
        throw new Error(cliResult.stderr || cliResult.stdout || 'wireshield-pair create failed');
      }
      const parsed = JSON.parse(cliResult.stdout.trim());
      const data: PairInitiateResult = {
        code: parsed.code,
        endpoint: '',
        port: String(parsed.listen_port ?? ''),
        interface: parsed.interface || '',
      };
      jsonLogger.info({ event: 'WireShield:initiate_success', host: safeHost, code: data.code });
      return { success: true, data };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'WireShield:initiate_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Join a pairing on a remote server (claims code, configures tunnel)
  ipcMain.handle('WireShield:join', async (_event, { host, username, password, code, name, port, endpoint }: {
    host: string; username: string; password?: string; code: string; name?: string; port?: number; endpoint?: string;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'WireShield:join', host: safeHost });

    if (!code || code.length !== 6) {
      return { success: false, error: 'Invalid pairing code' };
    }

    try {
      const ssh = await getPooledSSH(safeHost, username, password);

      let cli = `sudo ${WIRESHIELD_CLI} join ${shellQuote(code.toUpperCase())} --json`;
      if (name) cli += ` --name ${shellQuote(name)}`;
      if (port) cli += ` --port ${Number(port)}`;
      if (endpoint) cli += ` --endpoint ${shellQuote(endpoint)}`;

      const cliResult = await ssh.execCommand(cli);
      if (cliResult.code !== 0) {
        throw new Error(cliResult.stderr || cliResult.stdout || 'wireshield-pair join failed');
      }
      const parsed = JSON.parse(cliResult.stdout.trim());
      const data: PairCompleteResult = {
        status: 'connected',
        interface: parsed.interface,
        address: parsed.address,
        listenPort: String(parsed.listen_port ?? ''),
        peerEndpoint: parsed.peer_endpoint || '',
      };
      jsonLogger.info({ event: 'WireShield:join_success', host: safeHost, iface: data.interface });
      return { success: true, data };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'WireShield:join_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Poll pairing status from a remote server (for initiator waiting for joiner)
  ipcMain.handle('WireShield:poll', async (_event, { host, username, password, code }: {
    host: string; username: string; password?: string; code: string;
  }) => {
    const safeHost = assertSafeHost(host);

    try {
      const ssh = await getPooledSSH(safeHost, username, password);

      // WireShield finishes the initiator side itself while reporting status,
      // so a completed session already carries the finished tunnel details.
      const cliResult = await ssh.execCommand(
        `sudo ${WIRESHIELD_CLI} status ${shellQuote(code.toUpperCase())} --json`
      );
      if (cliResult.code !== 0) {
        throw new Error(cliResult.stderr || cliResult.stdout || 'wireshield-pair status failed');
      }
      const session = JSON.parse(cliResult.stdout.trim());
      if (session.status !== 'complete') {
        return { success: true, data: { claimed: false } };
      }
      return {
        success: true,
        data: {
          claimed: true,
          completed: {
            status: 'connected',
            interface: session.interface,
            address: '',
            listenPort: String(session.listen_port ?? ''),
            peerEndpoint: session.peer_endpoint || '',
          } as PairCompleteResult,
        },
      };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      return { success: false, error: e?.message };
    }
  });

  // Tear down a tunnel on a remote server
  ipcMain.handle('WireShield:teardown', async (_event, { host, username, password, iface }: {
    host: string; username: string; password?: string; iface: string;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'WireShield:teardown', host: safeHost, iface });

    if (!iface || !/^[a-z0-9-]{1,15}$/.test(iface)) {
      return { success: false, error: 'Invalid interface name' };
    }

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      const networkId = await resolveNetworkId(ssh, iface);
      await apiCall(ssh, 'DELETE', `/networks/${encodeURIComponent(networkId)}`);

      jsonLogger.info({ event: 'WireShield:teardown_success', host: safeHost, iface });
      return { success: true };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'WireShield:teardown_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Check tunnel health (handshake freshness) before running a backup
  ipcMain.handle('WireShield:preflight', async (_event, { host, username, password, iface }: {
    host: string; username: string; password?: string; iface?: string;
  }) => {
    const safeHost = assertSafeHost(host);

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      const tunnels = await fetchTunnels(ssh);
      const relevant = iface ? tunnels.filter((t) => t.name === iface) : tunnels;

      if (!relevant.length) {
        return {
          success: true,
          data: {
            healthy: false,
            output: iface ? `No paired tunnel named '${iface}'` : 'No paired tunnels on this server',
            error: '',
          },
        };
      }

      const now = Math.floor(Date.now() / 1000);
      let healthy = true;
      const lines = relevant.map((t) => {
        const newest = t.peers.reduce((max, p) => Math.max(max, p.latestHandshake), 0);
        if (!newest) {
          healthy = false;
          return `${t.name}: no handshake yet`;
        }
        const age = now - newest;
        if (age > 180) healthy = false;
        return `${t.name}: last handshake ${age}s ago`;
      });

      return { success: true, data: { healthy, output: lines.join('\n'), error: '' } };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      return { success: false, error: e?.message };
    }
  });

  // Run a pairing network readiness check on a remote server
  ipcMain.handle('WireShield:networkCheck', async (_event, { host, username, password, port }: {
    host: string; username: string; password?: string; port?: number;
  }) => {
    const safeHost = assertSafeHost(host);

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      const query = port ? `?listen_port=${Number(port)}` : '';
      const check = await apiCall(ssh, 'GET', `/pairing/preflight${query}`);

      return {
        success: true,
        data: {
          vpsReachable: Boolean(check?.vps_reachable),
          vpsHttpCode: Number(check?.vps_http_code) || 0,
          publicIp: check?.public_ip || '',
          localIp: check?.local_ip || '',
          listenPort: Number(check?.listen_port) || 0,
          natDiscovered: Boolean(check?.nat_discovered),
          natEndpoint: check?.nat_endpoint || '',
          status: check?.status === 'ok' ? 'ok' : 'warning',
          message: check?.message || '',
        },
      };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      return { success: false, error: e?.message };
    }
  });

  // Restart a tunnel on a remote server
  ipcMain.handle('WireShield:restart', async (_event, { host, username, password, iface }: {
    host: string; username: string; password?: string; iface: string;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'WireShield:restart', host: safeHost, iface });

    if (!iface || !/^[a-z0-9-]{1,15}$/.test(iface)) {
      return { success: false, error: 'Invalid interface name' };
    }

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      const networkId = await resolveNetworkId(ssh, iface);
      const data = await apiCall(ssh, 'POST', `/pairing/connections/${encodeURIComponent(networkId)}/restart`);

      jsonLogger.info({ event: 'WireShield:restart_success', host: safeHost, iface });
      return { success: true, data };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'WireShield:restart_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Add a peer to an existing tunnel
  ipcMain.handle('WireShield:addPeer', async (_event, { host, username, password, iface, pubkey, endpoint }: {
    host: string; username: string; password?: string; iface: string;
    pubkey: string; endpoint?: string; allowedIPs?: string; keepalive?: number;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'WireShield:addPeer', host: safeHost, iface });

    if (!iface || !/^[a-z0-9-]{1,15}$/.test(iface)) {
      return { success: false, error: 'Invalid interface name' };
    }
    if (!pubkey || pubkey.length !== 44) {
      return { success: false, error: 'A 44-character WireGuard public key is required' };
    }

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      const networkId = await resolveNetworkId(ssh, iface);
      // WireShield allocates the tunnel IP and AllowedIPs itself, so only the
      // identity of the peer is caller-supplied.
      const data = await apiCall(ssh, 'POST', `/networks/${encodeURIComponent(networkId)}/peers`, {
        hostname: (endpoint || '').split(':')[0] || pubkey.slice(0, 8),
        public_key: pubkey,
        endpoint: endpoint || null,
        platform: 'linux',
        peer_type: 'server',
      });

      jsonLogger.info({ event: 'WireShield:addPeer_success', host: safeHost, iface });
      return { success: true, data };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'WireShield:addPeer_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Override the AllowedIPs routed to an existing peer
  ipcMain.handle('WireShield:editPeer', async (_event, { host, username, password, iface, pubkey, allowedIPs }: {
    host: string; username: string; password?: string; iface: string;
    pubkey: string; endpoint?: string; allowedIPs?: string; keepalive?: number;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'WireShield:editPeer', host: safeHost, iface });

    if (!iface || !/^[a-z0-9-]{1,15}$/.test(iface)) {
      return { success: false, error: 'Invalid interface name' };
    }
    if (!allowedIPs) {
      return { success: false, error: 'WireShield negotiates peer endpoints and keepalive automatically; only Allowed IPs can be overridden' };
    }

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      const networkId = await resolveNetworkId(ssh, iface);
      const peerId = await resolvePeerId(ssh, networkId, pubkey);
      const data = await apiCall(ssh, 'PUT', `/peers/${encodeURIComponent(peerId)}/allowed-ips`, {
        allowed_ips: allowedIPs,
      });

      jsonLogger.info({ event: 'WireShield:editPeer_success', host: safeHost, iface });
      return { success: true, data };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'WireShield:editPeer_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });

  // Remove a peer from a tunnel
  ipcMain.handle('WireShield:removePeer', async (_event, { host, username, password, iface, pubkey }: {
    host: string; username: string; password?: string; iface: string; pubkey: string;
  }) => {
    const safeHost = assertSafeHost(host);
    jsonLogger.info({ event: 'WireShield:removePeer', host: safeHost, iface });

    if (!iface || !/^[a-z0-9-]{1,15}$/.test(iface)) {
      return { success: false, error: 'Invalid interface name' };
    }

    try {
      const ssh = await getPooledSSH(safeHost, username, password);
      const networkId = await resolveNetworkId(ssh, iface);
      const peerId = await resolvePeerId(ssh, networkId, pubkey);
      await apiCall(
        ssh,
        'DELETE',
        `/networks/${encodeURIComponent(networkId)}/peers/${encodeURIComponent(peerId)}`,
      );

      jsonLogger.info({ event: 'WireShield:removePeer_success', host: safeHost, iface });
      return { success: true };
    } catch (e: any) {
      disposePoolEntry(poolKey(safeHost, username));
      jsonLogger.error({ event: 'WireShield:removePeer_error', host: safeHost, error: String(e) });
      return { success: false, error: e?.message };
    }
  });
}
