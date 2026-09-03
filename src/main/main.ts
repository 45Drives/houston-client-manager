process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Noise-filtered console overrides (TLS warnings, APPIMAGE)
const SUPPRESS_PATTERNS = ['APPIMAGE env is not defined', 'NODE_TLS_REJECT_UNAUTHORIZED'];
const isSuppressed = (args: any[]) => {
  const msg = args.map(String).join(' ');
  return SUPPRESS_PATTERNS.some(p => msg.includes(p));
};

// Buffer early console output before Winston is ready
const _origConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

process.on('uncaughtException', (error) => {
  _origConsole.error('Uncaught Exception:', error);
  if (jsonLogger) jsonLogger.error({ event: 'uncaughtException', message: String(error), error: (error as any)?.stack || String(error) });
});

process.on('unhandledRejection', (reason, promise) => {
  _origConsole.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (jsonLogger) jsonLogger.error({ event: 'unhandledRejection', reason: String(reason), promise: String(promise) });
});

import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron';

if (process.env.ELECTRON_USER_DATA_DIR) {
  app.setPath('userData', process.env.ELECTRON_USER_DATA_DIR);
}

import { createLogger, format } from 'winston';
import { initAutoUpdates } from './updates';

// ---------------------------------------------------------------------------
// Log scrubbing — prevent passwords/secrets from leaking into log files
// ---------------------------------------------------------------------------

const SENSITIVE_KEYS = [
  'password', 'passwd', 'pass', 'pwd',
  'secret', 'token', 'authorization', 'auth',
];

function scrubString(str: string): string {
  if (!str) return str;
  let out = str;
  out = out.replace(/(password\s*[:=]\s*)([^,\s"'}]+)/gi, '$1***REDACTED***');
  out = out.replace(/("password"\s*:\s*)"([^"]*)"/gi, '$1"***REDACTED***"');
  out = out.replace(/('password'\s*:\s*)'([^']*)'/gi, "$1'***REDACTED***'");
  out = out.replace(/(token|secret)\s*[:=]\s*([^,\s"'}]+)/gi, '$1=***REDACTED***');
  return out;
}

function scrubValue(value: any): any {
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v));
  if (value && typeof value === 'object') {
    const clone: any = { ...value };
    for (const key of Object.keys(clone)) {
      if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
        clone[key] = '***REDACTED***';
      } else {
        clone[key] = scrubValue(clone[key]);
      }
    }
    return clone;
  }
  return value;
}
import DailyRotateFile from 'winston-daily-rotate-file';
import path, { join } from 'path';
import mdns from 'multicast-dns';
import os from 'os';
import fs from 'fs';
import net from 'net';
import { promises as dnsPromises } from 'dns';
import http from 'http';
import { Server } from './types';
import mountSmbPopup from './smbMountPopup';
import { ensureClientTools } from './installDepsPopup';
import { IPCRouter } from '../../houston-common/houston-common-lib/lib/electronIPC/IPCRouter';
import { getOS, getAssetSync } from './utils';
import {
  getDaemonFdaStatus,
  isDaemonInstalled,
  isTccProtectedPath,
  openFullDiskAccessSettings,
  revealDaemonBinary,
  MAC_DAEMON_BIN_PATH,
} from './backup/macDaemon';
import { v4 as uuidv4 } from 'uuid';
import { BackUpManager, BackUpManagerLin, BackUpManagerMac, BackUpManagerWin } from './backup';
import { server, unwrap } from '@45drives/houston-common-lib';
import { installServerDepsRemotely } from './installServerDeps';
import { getPin, rememberPin } from './certPins'
import { getCredentialManager } from './credentialManager';
import { assertSafeHost, assertSafeShare, assertSafeUsername } from './security';
import { checkSSH, verifySshCredentials } from './setupSsh';
import { disposeAllSSH } from './sshPool';
import { loadSettings, saveSettings, resetSettings } from './settingsStore';
import { handleBackupMessage } from './ipc/backupHandlers';
import { handleDiscoveryMessage } from './ipc/discoveryHandlers';
import { registerLogHandlers } from './ipc/logHandlers';
import { registerRestoreHandlers } from './ipc/restoreHandlers';
import { registerTopologyHandlers } from './ipc/topologyHandlers';
import { registerBulkSetupHandlers } from './ipc/bulkSetupHandlers';
import { registerServerManageHandlers } from './ipc/serverManageHandlers';
import { registerWireShieldHandlers } from './ipc/wireShieldHandlers';
import type { IPCHandlerContext } from './ipc/types';

let discoveredServers: Server[] = [];
export let jsonLogger: ReturnType<typeof createLogger>;

let lastBackupTaskSignature = '';

/**
 * Identity of the task set for change detection. `schedule.startDate` is
 * recomputed on every query and drifts by milliseconds, so it's rounded to the
 * minute — otherwise every poll would look like a change.
 */
function backupTaskSignature(tasks: Array<Record<string, any>>): string {
  return tasks
    .map((t) => {
      const start = t.schedule?.startDate ? new Date(t.schedule.startDate) : null;
      const startKey = start && !Number.isNaN(start.getTime())
        ? String(new Date(start).setSeconds(0, 0))
        : '';
      return [
        t.uuid, t.name, t.source, t.target, t.host, t.share,
        t.disabled, t.status, t.schedule?.repeatFrequency, startKey,
      ].join('|');
    })
    .sort()
    .join('\n');
}

// const blockerId = powerSaveBlocker.start("prevent-app-suspension");

const idFile = path.join(app.getPath('userData'), 'client-id.txt');
let installId = fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf-8').trim() : '';
if (!installId) { installId = uuidv4(); fs.writeFileSync(idFile, installId, 'utf-8'); }

const clientIdent = { installId };

ipcMain.on('renderer-ready', (e) => {
  e.sender.send('client-ident', clientIdent);
});

// request/response path
ipcMain.handle('get-client-ident', async () => ({ installId }))

// OAuth: open system browser + local loopback server to receive token.
// Google blocks embedded Chromium browsers, so we must use the real browser.
ipcMain.handle('oauth:open', async (_event, url: string) => {
  return new Promise<any>((resolve) => {
    const srv = http.createServer((req, res) => {
      if (!req.url?.startsWith('/oauth/callback')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const params = new URL(req.url, 'http://127.0.0.1').searchParams;
      const token = {
        service: params.get('service') || '',
        accessToken: params.get('accessToken') || '',
        refreshToken: params.get('refreshToken') || '',
        expiry: params.get('expiry') || '',
        userId: params.get('userId') || '',
      };

      // Send a friendly page back to the browser
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><body>
        <h2>Authentication Successful</h2>
        <p>You may close this tab and return to the app.</p>
        <script>setTimeout(function(){ window.close(); }, 1000);</script>
      </body></html>`);

      srv.close();
      if (token.accessToken && token.refreshToken) {
        resolve({ success: true, token });
      } else {
        resolve({ success: false });
      }
    });

    // Listen on a random available port on loopback
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as any).port;
      const separator = url.includes('?') ? '&' : '?';
      const oauthUrl = `${url}${separator}loopback_port=${port}`;
      shell.openExternal(oauthUrl);
    });

    // Timeout after 5 minutes if user never completes auth
    setTimeout(() => {
      srv.close();
      resolve({ success: false });
    }, 5 * 60 * 1000);
  });
});

app.commandLine.appendSwitch('ignore-certificate-errors', 'true');

function checkLogDir(): string {
  // LINUX: /home/<username>/.config/45drives-setup-wizard/logs       (IN DEV MODE: /home/<username>/config/Electron/logs/)
  // MAC:   /Users/<username>/Library/Application Support/45drives-setup-wizard/logs
  // WIN:   C:\Users\<username>\AppData\Roaming\45drives-setup-wizard\logs
  const baseLogDir = path.join(app.getPath('userData'), 'logs');
  try {
    if (!fs.existsSync(baseLogDir)) {
      fs.mkdirSync(baseLogDir, { recursive: true });
    }
    console.debug(` Log directory ensured: ${baseLogDir}`);
  } catch (e: any) {
    console.error(` Failed to create log directory (${baseLogDir}):`, e.message);
  }
  return baseLogDir;
}

function isPortOpen(ip: string, port: number, timeout = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, ip);
  });
}

// Discovery timeout — read from settings (default 60s)
const TIMEOUT_DURATION = () => loadSettings().discoveryInactivityTimeoutMs;
const serviceType = '_houstonserver._tcp.local';

const isPrivateV4 = (ip: string) =>
  /^10\./.test(ip) ||
  /^192\.168\./.test(ip) ||
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);

/** VPN, point-to-point and virtual transports that never carry a 45Drives server on their link. */
const VIRTUAL_IFACE_RE = /^(utun|tun|tap|wg|ppp|ipsec|awdl|llw|zt|vboxnet|docker|veth|virbr|br-)/i;

/** Widest subnet we will sweep; anything larger falls back to the /24 around our own address. */
const MAX_FALLBACK_HOSTS = 1024;
const FALLBACK_SCAN_CONCURRENCY = 128;

type LocalInterface = { name: string; address: string; netmask: string };

function getLocalInterface(): LocalInterface | null {
  const nets = os.networkInterfaces();
  const candidates: LocalInterface[] = [];

  for (const [name, items] of Object.entries(nets)) {
    for (const net of items ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (!isPrivateV4(net.address)) continue;
      candidates.push({ name, address: net.address, netmask: net.netmask });
    }
  }

  return candidates.find(c => !VIRTUAL_IFACE_RE.test(c.name)) ?? candidates[0] ?? null;
};

const getLocalIP = () => getLocalInterface()?.address ?? '127.0.0.1';

function ipToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** Usable host addresses on the interface's real subnet, excluding network, broadcast and self. */
function getSubnetHosts(address: string, netmask: string): string[] {
  const addr = ipToInt(address);
  const mask = ipToInt(netmask);
  if (addr === null || mask === null || mask === 0) return [];

  let network = (addr & mask) >>> 0;
  let broadcast = (network | (~mask >>> 0)) >>> 0;

  if (broadcast - network - 1 > MAX_FALLBACK_HOSTS) {
    network = (addr & 0xffffff00) >>> 0;
    broadcast = (network | 0xff) >>> 0;
  }

  const hosts: string[] = [];
  for (let n = network + 1; n < broadcast; n++) {
    if (n !== addr) hosts.push(intToIp(n));
  }
  return hosts;
}


let mainWindow: BrowserWindow | null = null;

function assertMainWindowSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Unauthorized IPC sender');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    // Linux taskbars read _NET_WM_ICON; without this they match WM_CLASS against
    // the .desktop file instead and often show a stale or generic icon.
    ...(process.platform === 'linux' ? { icon: getAssetSync('static', 'app-icon.png') } : {}),
    webPreferences: {
      sandbox: false,
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      javascript: true,
      backgroundThrottling: false,  // Disable throttling
      partition: 'persist:your-cookie-partition',
      webSecurity: true,                  // Enforces origin security
      allowRunningInsecureContent: false, // Prevents HTTP inside HTTPS
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only allow URLs we trust (optional but recommended)
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url); // Opens in the user's default browser
    }

    return { action: 'deny' }; // Prevent Electron from opening a new window
  });

  async function doFallbackScan(): Promise<Server[]> {
    const iface = getLocalInterface();
    if (!iface) {
      console.debug('[discovery] no usable local interface for fallback scan');
      return [];
    }

    const hosts = getSubnetHosts(iface.address, iface.netmask);
    console.debug(
      `[discovery] fallback scan on ${iface.name} ${iface.address}/${iface.netmask} — ${hosts.length} hosts`
    );

    async function probe(candidateIp: string): Promise<Server | null> {
      const portOpen = await isPortOpen(candidateIp, 9090);
      if (!portOpen) return null;
      console.debug("port open at 9090 ", candidateIp);

      try {
        const res = await fetch(`https://${candidateIp}:9090/`, {
          method: 'GET',
          cache: 'no-store',
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return null;

        console.debug("https at 9090 ", candidateIp);

        return {
          ip: candidateIp,
          name: candidateIp,
          status: 'unknown',
          setupComplete: false,
          serverName: candidateIp,
          shareName: '',
          setupTime: '',
          serverInfo: {
            moboMake: '',
            moboModel: '',
            serverModel: '',
            aliasStyle: '',
            chassisSize: '',
          },
          lastSeen: Date.now(),
          fallbackAdded: true
        } as Server;

      } catch {
        return null;
      }
    }

    // Sliding window: holds concurrency steady without making fast hosts wait on slow ones.
    const fallbackServers: Server[] = [];
    let next = 0;

    async function worker() {
      while (next < hosts.length) {
        const candidateIp = hosts[next++];
        try {
          const server = await probe(candidateIp);
          if (server) fallbackServers.push(server);
        } catch {
          // an unreachable host is not an error worth reporting
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(FALLBACK_SCAN_CONCURRENCY, hosts.length) }, worker)
    );

    if (fallbackServers.length) {
      discoveredServers = fallbackServers;
      mainWindow!.webContents.send('discovered-servers', discoveredServers);
    }

    return fallbackServers;
  }

  IPCRouter.initBackend(mainWindow!.webContents, ipcMain);

  let rendererIsReady = false;
  let bufferedNotifications: string[] = [];

  ipcMain.on('renderer-ready', (e) => {
    if (rendererIsReady) return;          // guard
    rendererIsReady = true;
    bufferedNotifications.forEach(msg => e.sender.send('notification', msg));
    bufferedNotifications = [];
  });

  // Relay store-manual-creds from renderer back to renderer (same window)
  // so CockpitWebview receives creds even for discovered servers that skip install
  ipcMain.on('store-manual-creds', (event, creds) => {
    mainWindow?.webContents.send('store-manual-creds', creds);
  });

  ipcMain.handle('verify-ssh-credentials', async (event, { host, username, password, authMethod, sshKeyPath, sshPassphrase }) => {
    assertMainWindowSender(event);
    const auth = authMethod === 'key'
      ? { username, method: 'key' as const, privateKeyPath: sshKeyPath, passphrase: sshPassphrase, password }
      : undefined;
    return verifySshCredentials(host, username, password, auth);
  });

  ipcMain.handle('install-cockpit-module', async (event, { host, username, password, authMethod, sshKeyPath, sshPassphrase }) => {
    assertMainWindowSender(event);
    jsonLogger.info({ event: 'install-cockpit-module', host });
    // 4. Store manual creds for login UI (if needed)
    mainWindow!.webContents.send('store-manual-creds', {
      ip: host,
      username,
      password,
    });

    try {
      const res = await installServerDepsRemotely({ host, username, password, authMethod, sshKeyPath, sshPassphrase });
      console.debug(" install-cockpit-module →", res);
      jsonLogger.info({ event: 'install-cockpit-module_success', host });
      return res;
    } catch (err) {
      jsonLogger.error({ event: 'install-cockpit-module_error', host, error: String(err) });
      console.error(" install-cockpit-module error:", err);
      throw err;            // so the renderer gets the real stack
    }
  });

  // ── Add Existing Server: install deps, wait for API, register app ───────

  ipcMain.handle('setup-existing-server', async (event, { host, username, password, authMethod, sshKeyPath, sshPassphrase }: { host: string; username: string; password: string; authMethod?: string; sshKeyPath?: string; sshPassphrase?: string }) => {
    assertMainWindowSender(event);
    jsonLogger.info({ event: 'setup-existing-server', host });
    const logs: string[] = [];
    try {
      const res = await installServerDepsRemotely({
        host,
        username,
        password,
        authMethod: authMethod as any,
        sshKeyPath,
        sshPassphrase,
        onProgress: (p) => {
          if (p.step === 'bootstrap-log') logs.push(p.label);
        },
      });
      if (!res.success) {
        return { success: false, error: res.error, logs };
      }
      return { success: true, reboot: res.reboot, logs };
    } catch (err: any) {
      jsonLogger.error({ event: 'setup-existing-server_error', host, error: String(err) });
      return { success: false, error: err?.message || String(err), logs };
    }
  });

  ipcMain.handle('wait-for-server-api', async (event, { host }: { host: string }) => {
    assertMainWindowSender(event);
    const safeHost = assertSafeHost(host);
    const maxAttempts = 30;
    const delayMs = 2000;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(`http://${safeHost}:9095/setup-status`, {
          method: 'GET',
          cache: 'no-store',
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          return { success: true };
        }
      } catch {
        // Not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return { success: false, error: `Server API on ${safeHost}:9095 did not respond after ${maxAttempts * delayMs / 1000}s.` };
  });

  ipcMain.handle('register-server-app', async (event, { host, username, password }: { host: string; username: string; password: string }) => {
    assertMainWindowSender(event);
    const safeHost = assertSafeHost(host);
    try {
      // Login to get JWT
      const loginRes = await fetch(`http://${safeHost}:9095/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(10000),
      });
      if (!loginRes.ok) {
        const body = await loginRes.json().catch(() => ({}));
        return { success: false, error: body?.error || `Login failed (HTTP ${loginRes.status})` };
      }
      const { token } = await loginRes.json();

      // Register the storage-wizard app
      const regRes = await fetch(`http://${safeHost}:9095/api/register-app`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ app: 'storage-wizard' }),
        signal: AbortSignal.timeout(15000),
      });
      if (!regRes.ok) {
        const body = await regRes.json().catch(() => ({}));
        return { success: false, error: body?.error || `Registration failed (HTTP ${regRes.status})` };
      }

      // Write setup log on the server so discovery sees it as "complete"
      // This is done via the broadcaster's own bootstrap, but let's also
      // update local discovery state immediately
      jsonLogger.info({ event: 'register-server-app_success', host: safeHost });
      return { success: true };
    } catch (err: any) {
      jsonLogger.error({ event: 'register-server-app_error', host: safeHost, error: String(err) });
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('get-os', () => getOS());

  ipcMain.handle("backup:isFirstRunNeeded", (event, host, share, smbUser) => {
    assertMainWindowSender(event);
    const manager = getBackUpManager();
    const os = getOS();
    if (
      manager &&
      (os === "rocky" || os === "debian" || os === "mac") &&
      typeof manager.isFirstBackupNeeded === "function"
    ) {
      return manager.isFirstBackupNeeded(host, share, smbUser);
    }
    return true;
  });

  // macOS only. The daemon and the app are separate executables, so TCC grants one and not
  // the other; the daemon reports its own status and the app just relays it.
  ipcMain.handle('mac:fdaStatus', (event, source?: string) => {
    assertMainWindowSender(event);
    if (getOS() !== 'mac') return { supported: false };
    return {
      supported: true,
      status: getDaemonFdaStatus(),
      daemonInstalled: isDaemonInstalled(),
      daemonPath: MAC_DAEMON_BIN_PATH,
      sourceNeedsAccess: source ? isTccProtectedPath(source) : false,
    };
  });

  ipcMain.handle('mac:openFdaSettings', (event) => {
    assertMainWindowSender(event);
    if (getOS() !== 'mac') return false;
    openFullDiskAccessSettings();
    revealDaemonBinary();
    return true;
  });
  
  ipcMain.handle('scan-network-fallback', async (event) => {
    assertMainWindowSender(event);
    return await doFallbackScan();
  });

  ipcMain.handle('add-manual-server', (event, p: { ip: string; name?: string; shareName?: string }) => {
    assertMainWindowSender(event);
    const ip = assertSafeHost(p.ip);
    const name = p.name || ip;
    const share = p.shareName || '';

    const existing = discoveredServers.find(s => s.ip === ip);
    if (existing) {
      existing.shareName = share || existing.shareName;
      existing.name = name || existing.name;
      existing.setupComplete = true;
      existing.status = 'complete';
      existing.lastSeen = Date.now();
      existing.manuallyAdded = true;
    } else {
      discoveredServers.push({
        ip,
        name,
        status: 'complete',
        lastSeen: Date.now(),
        setupComplete: true,
        shareName: share,
        serverName: name,
        setupTime: '',
        serverInfo: {
          moboMake: '',
          moboModel: '',
          serverModel: '',
          aliasStyle: '',
          chassisSize: '',
        },
        manuallyAdded: true,
        fallbackAdded: false,
      });
    }

    if (mainWindow) {
      mainWindow.webContents.send('discovered-servers', discoveredServers);
    }
    return { ok: true };
  });

  let discoveryEnabled = false;
  let mdnsInterval: NodeJS.Timeout | null = null;
  let pollActionInterval: NodeJS.Timeout | null = null;
  let clearInactiveServerInterval: NodeJS.Timeout | null = null;
  let lastMdnsResponseAt = Date.now();

  function startDiscoveryLoops() {
    if (discoveryEnabled) return;
    discoveryEnabled = true;

    const scanInterval = loadSettings().discoveryScanIntervalMs;

    // Probe straight away, then a short burst: a single query that races the
    // socket's group membership means waiting a whole scan interval to retry.
    queryMdns();
    [150, 500, 1500].forEach(delay => setTimeout(queryMdns, delay));

    mdnsInterval = setInterval(queryMdns, scanInterval);

    clearInactiveServerInterval = setInterval(() => {
      const now = Date.now();
      const before = discoveredServers.length;

      // Silence from every server at once means our own multicast socket went
      // deaf (interface/route change), not that the whole fleet went offline.
      // Hold the list until we hear something rather than emptying the UI.
      if (now - lastMdnsResponseAt > TIMEOUT_DURATION()) return;

      discoveredServers = discoveredServers.filter(srv =>
        now - srv.lastSeen <= TIMEOUT_DURATION() || srv.manuallyAdded === true
      );

      if (discoveredServers.length !== before) {
        mainWindow!.webContents.send('discovered-servers', discoveredServers);
      }
    }, scanInterval);

    pollActionInterval = setInterval(() => {
      const servers = discoveredServers.filter(s =>
        !s.manuallyAdded &&
        !s.fallbackAdded &&
        s.ip !== '127.0.0.1'
      );

      // run in parallel so one slow/offline host doesn't stall the whole loop
      void Promise.allSettled(servers.map(s => pollActions(s)));
    }, scanInterval);
  }

  function stopDiscoveryLoops() {
    discoveryEnabled = false;

    if (mdnsInterval) clearInterval(mdnsInterval);
    if (pollActionInterval) clearInterval(pollActionInterval);
    if (clearInactiveServerInterval) clearInterval(clearInactiveServerInterval);

    mdnsInterval = pollActionInterval = clearInactiveServerInterval = null;
  }

  ipcMain.handle('discovery:setEnabled', (event, enabled: boolean) => {
    assertMainWindowSender(event);
    if (enabled) startDiscoveryLoops();
    else stopDiscoveryLoops();
  });

  function notify(message: string) {
    if (!mainWindow || mainWindow.webContents?.isDestroyed()) return;
    if (!loadSettings().showNotifications) return;

    if (rendererIsReady) {
      mainWindow.webContents.send("notification", message);
    }
  }


  const handlerCtx: IPCHandlerContext = {
    getBackUpManager,
    notify,
    jsonLogger,
    mainWindow: mainWindow!,
  };

  registerRestoreHandlers(handlerCtx);
  registerTopologyHandlers({ jsonLogger });
  registerBulkSetupHandlers({ mainWindow: mainWindow!, jsonLogger });
  registerServerManageHandlers({ jsonLogger });
  registerWireShieldHandlers({ jsonLogger });

  IPCRouter.getInstance().addEventListener('action', async (data) => {
    if (data === "requestBackUpTasks") {
      const backUpManager = getBackUpManager();
      if (backUpManager) {
        const tasks = await backUpManager.queryTasks();
        IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({ type: 'sendBackupTasks', tasks }));

        const signature = backupTaskSignature(tasks);
        if (signature === lastBackupTaskSignature) {
          jsonLogger.debug({ event: 'requestBackUpTasks', count: tasks.length, unchanged: true });
        } else {
          lastBackupTaskSignature = signature;
          jsonLogger.info({ event: 'requestBackUpTasks', count: tasks.length, tasks });
        }
      }
    } else if (data === "requestHostname") {
      IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({
        type: "sendHostname",
        hostname: await unwrap(server.getHostname())
      }));
    } else if (data === "show_storage_setup_wizard" || data === "show_backup_setup_wizard" || data === "show_restore-backup_setup_wizard") {
      IPCRouter.getInstance().send('renderer', 'action', data);
    } else {
      try {
        const message = JSON.parse(data);

        if (message.type === 'requestBackUpTasksByIds' && Array.isArray(message.ids)) {
          const backUpManager = getBackUpManager();
          if (backUpManager) {
            const allTasks = await backUpManager.queryTasks();
            const matched = allTasks.filter(t => message.ids.includes(t.uuid));
            IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({ type: 'sendBackupTasksByIds', tasks: matched }));
          }
          return;
        }

        if (await handleBackupMessage(message, handlerCtx)) return;

        const discoveryCtx = {
          discoveredServers,
          mainWindow: mainWindow!,
          notify,
          mDNSClient,
          serviceType,
          TIMEOUT_DURATION: TIMEOUT_DURATION(),
          doFallbackScan,
          setDiscoveredServers: (servers: Server[]) => { discoveredServers = servers; },
        };
        if (await handleDiscoveryMessage(message, discoveryCtx)) return;

      } catch (error) {
        console.error("Failed to handle IPC action:", data, error);
      }
    }
  });


  mainWindow.maximize();

  // X11 window managers (Cinnamon on Mint especially) can hand the window OS
  // focus without Chromium restoring a focused frame, leaving inputs visually
  // focusable but deaf to keystrokes until the view is remounted.
  mainWindow.on('focus', () => mainWindow?.webContents.focus());

  mainWindow.webContents.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
  );

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
    const rendererPort = process.env.ELECTRON_RENDERER_PORT || process.argv[2];

    mainWindow.loadURL(`http://localhost:${rendererPort}`);
  } else {
    mainWindow.setMenu(null);

    mainWindow.loadFile(join(app.getAppPath(), 'renderer', 'index.html'));
  }

  mainWindow.webContents.send('client-ip', getLocalIP());

  // Set up mDNS for service discovery
  const mDNSClient = mdns(); // Correctly call as a function

  // multicast-dns joins the group on every interface, but pins *outbound* queries
  // to setMulticastInterface('0.0.0.0'), which lets Windows pick the send adapter
  // from the routing table — usually WSL/Hyper-V/VPN rather than the LAN NIC, so
  // queries never reach the servers. Bind an extra socket per real interface.
  const extraMdnsClients: any[] = process.platform !== 'win32' ? [] :
    Object.entries(os.networkInterfaces())
      .filter(([name]) => !VIRTUAL_IFACE_RE.test(name))
      .flatMap(([, addrs]) => addrs ?? [])
      .filter(a => a.family === 'IPv4' && !a.internal && isPrivateV4(a.address))
      .map(a => {
        try {
          const client = mdns({ interface: a.address });
          client.on('error', () => { });
          client.on('warning', () => { });
          client.on('response', handleMdnsResponse);
          return client;
        } catch {
          return null;
        }
      })
      .filter(client => client !== null);

  function queryMdns() {
    for (const client of [mDNSClient, ...extraMdnsClients]) {
      try {
        client.query({ questions: [{ name: serviceType, type: 'PTR' }] });
      } catch { }
    }
  }

  queryMdns();

  // Start listening for devices
  mDNSClient.on('response', handleMdnsResponse);

  async function handleMdnsResponse(response: any) {
    // Combine answers + additionals into one array
    const records = [
      ...response.answers,
      ...(response.additionals ?? []),
    ];

    server_search:
    for (const answer1 of records) {
      if (answer1.type === 'SRV' && answer1.name.includes(serviceType)) {
        // Find related 'A' and 'TXT' records in the combined list
        const ipAnswer = records.find(a => a.type === 'A' && a.name === (answer1.data as { target: string }).target);
        const txtAnswer = records.find(a => a.type === 'TXT' && a.name === answer1.name);

        // Parse TXT into a map
        const txtRecord: Record<string, string> = {};
        if (txtAnswer && Array.isArray(txtAnswer.data)) {
          txtAnswer.data.forEach((buf: Buffer) => {
            const s = buf?.toString?.() ?? '';
            const eq = s.indexOf('=');
            if (eq === -1) return;
            const k = s.slice(0, eq).trim();
            const v = s.slice(eq + 1).trim();
            if (k) txtRecord[k] = v;
          });
        }

        // Fallback path: TXT contains ip=...
        const serverIp: string | null =
          (ipAnswer && ipAnswer.data ? (ipAnswer.data as string) : null) ||
          (txtRecord.ip ? String(txtRecord.ip) : null);

        if (serverIp) {
          // Never accept loopback as a discovered server
          if (serverIp === '127.0.0.1') continue;
          if (serverIp === '0.0.0.0') continue;

          const instance = answer1.name;    // e.g. "hl4-test._houstonserver._tcp.local"

          // Derive a friendly name (strip off the service suffix)
          const [bare] = instance.split('._');
          const displayName = `${bare}.local`;

          // Build Server object from mDNS response
          const server: Server = {
            ip: serverIp,
            name: displayName,
            status: 'unknown',  // overwritten below
            lastSeen: Date.now(),
            setupComplete: txtRecord.setupComplete === 'true',
            serverName: txtRecord.serverName || displayName,
            shareName: txtRecord.shareName,
            setupTime: txtRecord.setupTime,
            serverInfo: {
              moboMake: txtRecord.moboMake,
              moboModel: txtRecord.moboModel,
              serverModel: txtRecord.serverModel,
              aliasStyle: txtRecord.aliasStyle,
              chassisSize: txtRecord.chassisSize,
            },
            manuallyAdded: false,
            fallbackAdded: false,
          };

          // Optionally refine using HTTP status if reachable
          async function refineFromSetupStatus(target: Server) {
            try {
              const fetchResponse = await fetch(`http://${target.ip}:9095/setup-status`, {
                cache: 'no-store',
                signal: AbortSignal.timeout(2000),
              });

              if (!fetchResponse.ok) return;
              const setupStatusResponse = await fetchResponse.json();

              if (typeof setupStatusResponse.setupComplete === 'boolean') {
                target.setupComplete = setupStatusResponse.setupComplete;
                target.status = setupStatusResponse.setupComplete ? 'complete' : 'not complete';
              } else if (typeof setupStatusResponse.status === 'string') {
                target.status = setupStatusResponse.status;
                if (target.status === 'complete') target.setupComplete = true;
              }

              target.shareName = setupStatusResponse.shareName || target.shareName;
              target.serverName = setupStatusResponse.serverName || target.serverName;
              target.setupTime = setupStatusResponse.setupTime || target.setupTime;
              target.serverInfo = {
                moboMake: setupStatusResponse.moboMake || target.serverInfo!.moboMake,
                moboModel: setupStatusResponse.moboModel || target.serverInfo!.moboModel,
                serverModel: setupStatusResponse.serverModel || target.serverInfo!.serverModel,
                aliasStyle: setupStatusResponse.aliasStyle || target.serverInfo!.aliasStyle,
                chassisSize: setupStatusResponse.chassisSize || target.serverInfo!.chassisSize,
              };
            } catch {
              // Expected when server isn't reachable; silently fall back to mDNS TXT
            }
          }

          // upsert into discoveredServers
          const existing = discoveredServers.find(s => s.ip === server.ip);

          if (!existing) {
            discoveredServers.push(server);
          } else {
            Object.assign(existing, {
              name: displayName,
              lastSeen: server.lastSeen,
              // An mDNS packet carries no live status, so falling back to 'unknown' here
              // makes already-known servers blink out of status-filtered lists until the
              // HTTP probe finishes. Hold the last verdict; refineFromSetupStatus updates it.
              status: existing.status !== 'unknown' ? existing.status : server.status,
              setupComplete: existing.setupComplete || server.setupComplete,
              serverName: server.serverName,
              shareName: server.shareName,
              setupTime: server.setupTime,
              serverInfo: server.serverInfo,
              fallbackAdded: false
            });
          }

          // Sync discovery hostname↔IP into credential vault to merge duplicate server records
          getCredentialManager().syncDiscovery(server.name, server.ip, {
            shareName: server.shareName,
            setupComplete: server.setupComplete,
          });

          // Show the server as soon as mDNS names it. The HTTP probe below only
          // sharpens setup status and costs up to 2s against an unreachable host,
          // so it must not gate the first paint of the list.
          lastMdnsResponseAt = Date.now();
          sendDiscoveredServers();

          if (discoveryEnabled) {
            await refineFromSetupStatus(existing ?? server);
            sendDiscoveredServers();
          }

          break server_search;
        }
      }
    }
  }

  function sendDiscoveredServers() {
    if (!mainWindow || mainWindow.webContents?.isDestroyed()) return;
    mainWindow.webContents.send('discovered-servers', discoveredServers);
    mainWindow.webContents.send('client-ip', getLocalIP());
  }


  async function pollActions(server: Server) {
    try {
      const response = await fetch(`http://${server.ip}:9095/actions?client_ip=${getLocalIP()}`, {
        signal: AbortSignal.timeout(3000),
      });
      const data = await response.json();

      // A server answering HTTP is alive, so keep it out of the inactivity sweep
      // even when its mDNS announcements get dropped (reflected/cross-subnet mDNS).
      server.lastSeen = Date.now();

      if (data.action) {

        if (data.action === "mount_samba_client") {
          mountSmbPopup(data.smb_host, data.smb_share, data.smb_user, data.smb_pass, mainWindow!);
        } else {
          console.debug("Unknown new actions.", server);
        }
      }
    } catch (error) {
    }
  }

  IPCRouter.getInstance().addEventListener('mountSambaClient', async (data) => {
    let result
    try {
     result = await mountSmbPopup(data.smb_host, data.smb_share, data.smb_user, data.smb_pass, mainWindow!, "silent");

    } catch (e: any) {
      result = { error: e && e.message ? e.message : "Failed to mount" };
    }
    IPCRouter.getInstance().send("renderer", "action", JSON.stringify({
      action: "mountSmbResult",
      result: result
    }))
  });

  app.on('window-all-closed', function () {
    ipcMain.removeAllListeners('message')
    stopDiscoveryLoops();
    mDNSClient.destroy();
    extraMdnsClients.forEach(client => { try { client.destroy(); } catch { } });
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (_wawevent, webPreferences, _params) => {
    webPreferences.preload = `${__dirname}/webview-preload.js`;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
  });

  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});


app.whenReady().then(() => {
  const resolvedLogDir = checkLogDir();
  console.debug('userData is here:', app.getPath('userData'))
  console.debug('log dir:', resolvedLogDir);

  // Migrate legacy plaintext credential files to encrypted vault
  try {
    const imported = getCredentialManager().importLegacyCredentials();
    if (imported > 0) {
      console.info(`Migrated ${imported} legacy credential(s) to encrypted vault`);
    }
  } catch (err) {
    console.warn('Legacy credential migration failed (non-fatal):', err);
  }
  jsonLogger = createLogger({
    level: 'info',
    format: format.combine(
      format.timestamp(),
      format((info) => {
        if (
          typeof info.message === 'string' &&
          info.message.includes(
            'Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED'
          )
        ) {
          return false;
        }
        return info;
      })(),
      format((info) => scrubValue(info))(),
      format.json()
    ),
    transports: [
      new DailyRotateFile({
        dirname: resolvedLogDir,
        filename: '45drives-storage-wizard-%DATE%.json',
        datePattern: 'YYYY-MM-DD',
        maxFiles: `${loadSettings().logRetentionDays}d`,
        zippedArchive: true,
      })
    ]
  });

  _origConsole.info('Logging initialized. Log dir:', resolvedLogDir);


  session.defaultSession.setCertificateVerifyProc((req, cb) => {
    // Quick dev escape for localhost
    if (process.env.NODE_ENV === 'development' &&
      (req.hostname === 'localhost' || req.hostname.startsWith('127.')))
      return cb(0);

    const presented = req.certificate.fingerprint;
    const pinned = getPin(req.hostname);

    // known & matches → allow
    if (pinned && pinned.fingerprint === presented) return cb(0);

    // known & changed → ask to update or block
    if (pinned && pinned.fingerprint !== presented) {
      dialog.showMessageBox({
        type: 'warning',
        message: `Certificate changed for ${req.hostname}`,
        detail: `Pinned: ${pinned.fingerprint}\nPresented: ${presented}\n\nBlock unless you know the cert rotated.`,
        buttons: ['Block', 'Trust & Update Pin'],
        cancelId: 0, defaultId: 0, noLink: true
      }).then(({ response }) => {
        if (response === 1) { rememberPin(req.hostname, presented); cb(0); }
        else cb(-2);
      });
      return;
    }

    // first seen → TOFU prompt
    dialog.showMessageBox({
      type: 'question',
      message: `Trust this server?`,
      detail: `Host: ${req.hostname}\nFingerprint: ${presented}`,
      buttons: ['Cancel', 'Trust'],
      cancelId: 0, defaultId: 1, noLink: true
    }).then(({ response }) => {
      if (response === 1) { rememberPin(req.hostname, presented); cb(0); }
      else cb(-2);
    });
  });
  
  // Monkey-patch console to route through Winston
  console.log = (...args: any[]) => {
    if (!isSuppressed(args)) {
      _origConsole.log(...args);
      jsonLogger.info({ message: scrubString(args.map(String).join(' ')) });
    }
  };
  console.info = (...args: any[]) => {
    if (!isSuppressed(args)) {
      _origConsole.info(...args);
      jsonLogger.info({ message: scrubString(args.map(String).join(' ')) });
    }
  };
  console.warn = (...args: any[]) => {
    if (!isSuppressed(args)) {
      _origConsole.warn(...args);
      jsonLogger.warn({ message: scrubString(args.map(String).join(' ')) });
    }
  };
  console.error = (...args: any[]) => {
    if (!isSuppressed(args)) {
      _origConsole.error(...args);
      jsonLogger.error({ message: scrubString(args.map(String).join(' ')) });
    }
  };
  console.debug = (...args: any[]) => {
    _origConsole.debug(...args);
    jsonLogger.debug({ message: scrubString(args.map(String).join(' ')) });
  };

  // Handle renderer-log messages from preload bridge
  ipcMain.on('renderer-log', (_event, payload: { level: string; args: any[] }) => {
    const { level, args } = payload || {};
    if (!args || !Array.isArray(args)) return;
    const mapped = level === 'log' ? 'info' : (level || 'info');
    const message = scrubString(args.map(String).join(' '));
    // Filter out webview console output and other noise
    if (message.startsWith('[webview:') || message.includes('ZFS Notification DBus')) return;
    if (['error', 'warn', 'info', 'debug'].includes(mapped)) {
      (jsonLogger as any)[mapped]({ message, source: 'renderer' });
    } else {
      jsonLogger.info({ message, source: 'renderer' });
    }
  });

  // Structured activity from embedded Cockpit modules (scheduler, setup wizard, …),
  // relayed up through CockpitWebview so it lands in the client's own log viewer.
  ipcMain.on('logs:module-event', (_event, entry: any) => {
    if (!entry || typeof entry.event !== 'string') return;
    const level = ['error', 'warn', 'info', 'debug'].includes(entry.level) ? entry.level : 'info';
    (jsonLogger as any)[level]({
      event: entry.event,
      source: entry.module || 'cockpit',
      message: scrubString(entry.summary || entry.event),
      ...(entry.details ? { details: scrubString(String(entry.details)) } : {}),
      ...(entry.data && typeof entry.data === 'object' ? entry.data : {}),
      moduleTimestamp: entry.timestamp,
    });
  });

  // Auto-updates are now handled by src/main/updates.ts
  initAutoUpdates(() => mainWindow);

  ipcMain.handle('session:clear-origin', async (_event, origin: string) => {
    jsonLogger.info({ event: 'session:clear-origin', origin });
    try {
      const sess = session.fromPartition('persist:authSession');
      await sess.clearStorageData({
        origin,
        storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers'],
      });
    } catch (e) {
      jsonLogger.error({ event: 'session:clear-origin_error', origin, error: String(e) });
      console.error('session:clear-origin error:', e);
    }
  });

  ipcMain.handle("is-dev", async () => process.env.NODE_ENV === 'development');

  ipcMain.handle('dialog:openFolder', async (event) => {
    assertMainWindowSender(event);
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'], // Opens folder selection dialog
    });

    return result.canceled ? null : result.filePaths[0]; // Return full folder path
  });

  ipcMain.handle('dialog:openSshKey', async (event) => {
    assertMainWindowSender(event);
    const result = await dialog.showOpenDialog({
      title: 'Select SSH Private Key',
      properties: ['openFile', 'showHiddenFiles'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // ── Server Credential IPC (replaces keytar-based creds.ipc) ────────
  ipcMain.handle('cred:list-servers', (event) => {
    assertMainWindowSender(event);
    return getCredentialManager().listServers();
  });

  ipcMain.handle('cred:get-for', (event, host: string) => {
    assertMainWindowSender(event);
    return getCredentialManager().getForHost(assertSafeHost(host));
  });

  ipcMain.handle('cred:save', (event, p: { host: string; name?: string; username: string; password: string; favorite?: boolean; sshKeyPath?: string; sshPassphrase?: string }) => {
    assertMainWindowSender(event);
    const safeHost = assertSafeHost(p.host);

    // Cross-reference discovery to merge hostname↔IP before dedup
    const discovered = discoveredServers.find(s =>
      s.ip === safeHost || s.name?.toLowerCase() === safeHost.toLowerCase()
    );
    if (discovered) {
      getCredentialManager().syncDiscovery(discovered.name, discovered.ip, {
        shareName: discovered.shareName,
        setupComplete: discovered.setupComplete,
      });
    }

    const id = getCredentialManager().storeServer(
      safeHost,
      assertSafeUsername(p.username),
      p.password,
      { name: p.name, favorite: p.favorite, sshKeyPath: p.sshKeyPath, sshPassphrase: p.sshPassphrase }
    );
    jsonLogger.info({ event: 'cred:save', host: p.host, username: p.username });
    return { ok: true, id };
  });

  ipcMain.handle('cred:remove', (event, id: string) => {
    assertMainWindowSender(event);
    jsonLogger.info({ event: 'cred:remove', credentialId: id });
    getCredentialManager().removeById(id);
    return { ok: true };
  });

  ipcMain.handle('cred:set-favorite', (event, id: string, fav: boolean) => {
    assertMainWindowSender(event);
    getCredentialManager().setFavorite(id, fav);
    return { ok: true };
  });

  ipcMain.handle('cred:set-name', (event, id: string, name: string) => {
    assertMainWindowSender(event);
    getCredentialManager().setName(id, name);
    return { ok: true };
  });

  ipcMain.handle('cred:touch', (event, id: string) => {
    assertMainWindowSender(event);
    getCredentialManager().touch(id);
    return { ok: true };
  });

  // ── Unified Servers IPC (used by useServers composable) ───────────────

  ipcMain.handle('servers:list', (event) => {
    assertMainWindowSender(event);
    return getCredentialManager().listAllServers();
  });

  ipcMain.handle('servers:add', (event, p: { host: string; shareName: string; username: string; password: string; hostname?: string; smbUser?: string; smbPass?: string; sshKeyPath?: string; sshPassphrase?: string; name?: string; favorite?: boolean; setupComplete?: boolean }) => {
    assertMainWindowSender(event);
    const safeHost = assertSafeHost(p.host);

    // Cross-reference discovery to fill in hostname↔IP before dedup check
    const discovered = discoveredServers.find(s =>
      s.ip === safeHost || s.name?.toLowerCase() === safeHost.toLowerCase()
    );
    if (discovered) {
      getCredentialManager().syncDiscovery(discovered.name, discovered.ip, {
        shareName: discovered.shareName,
        setupComplete: discovered.setupComplete,
      });
    }

    const id = getCredentialManager().addServerEntry(
      safeHost,
      p.shareName ? assertSafeShare(p.shareName) : '',
      assertSafeUsername(p.username),
      p.password,
      {
        name: p.name,
        favorite: p.favorite,
        hostname: p.hostname ? assertSafeHost(p.hostname) : undefined,
        smbUser: p.smbUser ? assertSafeUsername(p.smbUser) : undefined,
        smbPass: p.smbPass,
        sshKeyPath: p.sshKeyPath,
        sshPassphrase: p.sshPassphrase,
        setupComplete: p.setupComplete,
      }
    );
    jsonLogger.info({ event: 'servers:add', host: p.host, shareName: p.shareName, username: p.username });
    return { ok: true, id };
  });

  ipcMain.handle('servers:update', (event, p: { id: string; host?: string; hostname?: string; ip?: string; shareName?: string; username?: string; password?: string; smbUser?: string; smbPass?: string; name?: string; favorite?: boolean }) => {
    assertMainWindowSender(event);
    const newId = getCredentialManager().updateServerEntry(p.id, {
      host: p.host ? assertSafeHost(p.host) : undefined,
      hostname: p.hostname !== undefined ? (p.hostname ? assertSafeHost(p.hostname) : '') : undefined,
      ip: p.ip !== undefined ? (p.ip ? assertSafeHost(p.ip) : '') : undefined,
      shareName: p.shareName !== undefined ? (p.shareName ? assertSafeShare(p.shareName) : '') : undefined,
      username: p.username ? assertSafeUsername(p.username) : undefined,
      password: p.password,
      smbUser: p.smbUser !== undefined ? (p.smbUser ? assertSafeUsername(p.smbUser) : '') : undefined,
      smbPass: p.smbPass,
      name: p.name,
      favorite: p.favorite,
    });
    jsonLogger.info({ event: 'servers:update', oldId: p.id, newId });
    return { ok: true, id: newId };
  });

  ipcMain.handle('servers:remove', (event, id: string) => {
    assertMainWindowSender(event);
    getCredentialManager().removeServerEntry(id);
    jsonLogger.info({ event: 'servers:remove', id });
    return { ok: true };
  });

  ipcMain.handle('servers:set-favorite', (event, id: string, fav: boolean) => {
    assertMainWindowSender(event);
    getCredentialManager().setServerFavorite(id, fav);
    return { ok: true };
  });

  ipcMain.handle('servers:touch', (event, id: string) => {
    assertMainWindowSender(event);
    getCredentialManager().touchServer(id);
    return { ok: true };
  });

  ipcMain.handle('servers:get-smb-creds', (event, { host }: { host: string }) => {
    assertMainWindowSender(event);
    const safeHost = assertSafeHost(host);
    const creds = getCredentialManager().getSmbCredentials(safeHost);
    if (creds) {
      return { found: true, share: creds.share, username: creds.username, password: creds.password };
    }
    return { found: false };
  });

  // ── App Settings IPC ──────────────────────────────────────────────────
  ipcMain.handle('settings:get', (event) => {
    assertMainWindowSender(event);
    return loadSettings();
  });

  ipcMain.handle('settings:set', (event, partial: Record<string, unknown>) => {
    assertMainWindowSender(event);
    return saveSettings(partial as any);
  });

  ipcMain.handle('settings:reset', (event) => {
    assertMainWindowSender(event);
    return resetSettings();
  });

  // ── Credential Manager IPC (encrypted vault) ──────────────────────────
  ipcMain.handle('credentials:store', (event, { host, share, username, password }: { host: string; share: string; username: string; password: string }) => {
    assertMainWindowSender(event);
    const safeHost = assertSafeHost(host);
    const safeShare = assertSafeShare(share);
    const safeUser = assertSafeUsername(username);
    getCredentialManager().store(safeHost, safeShare, safeUser, password);
    jsonLogger.info({ event: 'credentials:store', host: safeHost, share: safeShare, username: safeUser });
    return { success: true };
  });

  ipcMain.handle('credentials:list', (event, { host }: { host?: string } = {}) => {
    assertMainWindowSender(event);
    const cm = getCredentialManager();
    return host ? cm.listForHost(assertSafeHost(host)) : cm.list();
  });

  ipcMain.handle('credentials:remove', (event, { host, share, username }: { host: string; share: string; username: string }) => {
    assertMainWindowSender(event);
    // Remove only does a dictionary key lookup+delete — no shell/path risk.
    // Use lenient validation so legacy credentials with unusual share names can be removed.
    const safeHost = assertSafeHost(host);
    const safeUsername = assertSafeUsername(username);
    const safeShare = (share || '').trim();
    if (!safeShare) throw new Error('Share is required');
    const removed = getCredentialManager().remove(safeHost, safeShare, safeUsername);
    jsonLogger.info({ event: 'credentials:remove', host: safeHost, share: safeShare, username: safeUsername, removed });
    return { success: removed };
  });

  ipcMain.handle('credentials:update', (event, { oldHost, oldShare, oldUsername, host, share, username, password }: {
    oldHost: string; oldShare: string; oldUsername: string;
    host: string; share: string; username: string; password?: string;
  }) => {
    assertMainWindowSender(event);
    const cm = getCredentialManager();
    const safeOldHost = assertSafeHost(oldHost);
    const safeOldShare = (oldShare || '').trim();
    const safeOldUser = assertSafeUsername(oldUsername);
    const safeHost = assertSafeHost(host);
    const safeShare = assertSafeShare(share);
    const safeUser = assertSafeUsername(username);

    // Retrieve old password before removing, in case we need it
    let resolvedPassword = password;
    if (!resolvedPassword) {
      const existing = cm.retrieve(safeOldHost, safeOldShare, safeOldUser);
      if (existing) {
        resolvedPassword = existing.password;
      } else {
        throw new Error('Password is required when changing host, share, or username.');
      }
    }

    // If key changed, remove old entry
    const oldKey = `${safeOldHost}\0${safeOldShare}\0${safeOldUser}`.toLowerCase();
    const newKey = `${safeHost}\0${safeShare}\0${safeUser}`.toLowerCase();
    if (oldKey !== newKey) {
      cm.remove(safeOldHost, safeOldShare, safeOldUser);
    }

    // Store new (or updated) credential
    cm.store(safeHost, safeShare, safeUser, resolvedPassword);

    jsonLogger.info({ event: 'credentials:update', oldHost: safeOldHost, newHost: safeHost, share: safeShare, username: safeUser });
    return { success: true };
  });

  ipcMain.handle('credentials:test-connection', async (event, { host }: { host: string }) => {
    assertMainWindowSender(event);
    const safeHost = assertSafeHost(host);
    const reachable = await checkSSH(safeHost, 5000);
    return { host: safeHost, reachable };
  });

  ipcMain.handle('backup:validate-smb-credentials', async (event, { host, share, username, password }: { host: string; share: string; username: string; password: string }) => {
    assertMainWindowSender(event);
    const safeHost = assertSafeHost(host);
    const safeShare = assertSafeShare(share);
    const safeUser = assertSafeUsername(username);
    const { execFile: execFileCb } = require('child_process');
    const platform = getOS();

    type Failure = { valid: false; error: string; reason: 'auth' | 'unreachable' | 'share' | 'unknown' };
    type Attempt = { valid: true } | Failure;

    const isIpLiteral = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');

    // Avahi advertises an IPv6 link-local AAAA record alongside the A record, and the
    // Windows SMB redirector cannot use a scoped fe80:: address as a UNC target — it
    // fails with ERROR_GEN_FAILURE. Try the known IPv4 address first, name second.
    const record = (() => {
      try { return getCredentialManager().findServer(safeHost); } catch { return null; }
    })();
    const candidates = [
      ...(isIpLiteral(safeHost) ? [safeHost] : [record?.ip ?? '', safeHost]),
      ...(isIpLiteral(safeHost) ? [record?.hostname ?? ''] : []),
    ]
      .filter(Boolean)
      .map(h => assertSafeHost(h))
      .filter((h, i, all) => all.findIndex(x => x.toLowerCase() === h.toLowerCase()) === i);

    const classify = (message: string): Failure['reason'] => {
      if (/logon failure|user name or password is incorrect|access is denied|LOGON_FAILURE|ACCESS_DENIED|1326|1331|1327/i.test(message)) return 'auth';
      if (/bad_network_name|network name cannot be found|network name is no longer available|NT_STATUS_BAD_NETWORK_NAME/i.test(message)) return 'share';
      if (/network path was not found|network location cannot be reached|not functioning|cannot find path|no such host|ENOTFOUND|EAI_AGAIN|timed out|unreachable|53\b|64\b|67\b|1231\b/i.test(message)) return 'unreachable';
      return 'unknown';
    };

    const runCheck = (targetHost: string): Promise<Attempt> => new Promise((resolve) => {
      if (platform === 'win') {
        const ps = [
          '$ErrorActionPreference = "Stop"',
          '$secure = ConvertTo-SecureString $env:HCM_SMB_PASS -AsPlainText -Force',
          '$cred = New-Object System.Management.Automation.PSCredential($env:HCM_SMB_USER, $secure)',
          'try {',
          '  New-PSDrive -Name HCMTest -PSProvider FileSystem -Root $env:HCM_SMB_ROOT -Credential $cred -ErrorAction Stop | Out-Null',
          '  Remove-PSDrive -Name HCMTest -Force -ErrorAction SilentlyContinue',
          '  Write-Output "OK"',
          '} catch {',
          '  Write-Output ("FAIL:" + $_.Exception.Message)',
          '}',
        ].join('\n');

        // -EncodedCommand avoids stdin and shell quoting entirely; the script carries no
        // secrets, so only the credentials need to stay in the environment.
        const encoded = Buffer.from(ps, 'utf16le').toString('base64');

        execFileCb(
          'powershell',
          ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
          {
            timeout: 20000,
            windowsHide: true,
            env: {
              ...process.env,
              HCM_SMB_USER: safeUser,
              HCM_SMB_PASS: password,
              HCM_SMB_ROOT: `\\\\${targetHost}\\${safeShare}`,
            },
          },
          (err: any, stdout: string, stderr: string) => {
            const output = (stdout || '').trim();
            jsonLogger.info({
              event: 'smb:validate.powershell',
              host: targetHost,
              share: safeShare,
              exitCode: err?.code ?? 0,
              killed: !!err?.killed,
              stdoutChars: output.length,
              stderr: (stderr || '').trim().slice(0, 500) || undefined,
            });
            if (output.split(/\r?\n/).some(line => line.trim() === 'OK')) {
              resolve({ valid: true });
              return;
            }
            if (err?.killed) {
              resolve({
                valid: false,
                reason: 'unreachable',
                error: `${targetHost} accepted the connection but never answered the file sharing request. This usually means traffic is being dropped between this computer and the server.`,
              });
              return;
            }
            const detail = output.replace(/^FAIL:/m, '').trim()
              || (stderr || '').trim()
              || `PowerShell exited without output (code ${err?.code ?? 'unknown'})`;
            resolve({ valid: false, error: detail, reason: classify(detail) });
          }
        );
      } else {
        // smbclient on Linux/macOS — credentials go through the environment, not argv.
        const args = ['-L', `//${targetHost}`, '-U', safeUser, '-g'];
        const child = execFileCb(
          'smbclient',
          args,
          { timeout: 20000, env: { ...process.env, PASSWD: password } },
          (err: any, stdout: string, stderr: string) => {
            const output = `${stdout}\n${stderr}`;
            if (err?.code === 'ENOENT') {
              resolve({
                valid: false,
                reason: 'unknown',
                error: platform === 'mac'
                  ? 'smbclient is not installed on this Mac, so the share credentials cannot be verified. Install it with "brew install samba" and try again.'
                  : 'smbclient is not installed on this computer, so the share credentials cannot be verified. Install the "smbclient" package (e.g. sudo apt install smbclient) and try again.',
              });
            } else if (/NT_STATUS_LOGON_FAILURE|NT_STATUS_ACCESS_DENIED/i.test(output)) {
              resolve({ valid: false, error: 'Invalid username or password', reason: 'auth' });
            } else if (err && !/Disk\|/i.test(stdout)) {
              // smbclient can exit non-zero while still listing shares
              resolve({ valid: false, error: output.trim() || `smbclient failed without output (code ${err.code ?? 'unknown'})`, reason: classify(output) });
            } else {
              resolve({ valid: true });
            }
          }
        );
        // Close stdin so a password prompt can never block the check
        child.stdin?.end();
      }
    });

    const attempt = async (targetHost: string): Promise<Attempt> => {
      let probeHost = targetHost;
      if (!isIpLiteral(targetHost)) {
        let addresses: { address: string; family: number }[];
        try {
          addresses = await dnsPromises.lookup(targetHost, { all: true });
        } catch {
          return {
            valid: false,
            reason: 'unreachable',
            error: `Could not resolve "${targetHost}". The server name may have changed — reboot the server after a name change, or add it by IP address.`,
          };
        }
        jsonLogger.info({
          event: 'smb:validate.resolve',
          host: targetHost,
          addresses: addresses.map(a => `${a.address}/v${a.family}`),
        });
        const routable = addresses.find(a => a.family === 4 || !/^fe80:/i.test(a.address));
        if (!routable) {
          return {
            valid: false,
            reason: 'unreachable',
            error: `"${targetHost}" only resolves to an IPv6 link-local address, which Windows cannot use for file sharing. Connect to the server by IP address instead.`,
          };
        }
        probeHost = routable.address;
      }
      const portOpen = await isPortOpen(probeHost, 445, 5000);
      jsonLogger.info({ event: 'smb:validate.probe', host: targetHost, probeHost, port: 445, open: portOpen });
      if (!portOpen) {
        return {
          valid: false,
          reason: 'unreachable',
          error: `${targetHost} is not reachable on file sharing port 445. Check that the server is powered on, on the same network, and that Samba is running.`,
        };
      }
      return runCheck(targetHost);
    };

    jsonLogger.info({
      event: 'smb:validate.start',
      host: safeHost,
      share: safeShare,
      username: safeUser,
      knownRecord: record ? { hostname: record.hostname || null, ip: record.ip || null } : null,
      candidates,
    });

    // smbclient does the actual check on Linux/macOS, so offer to install it before failing.
    if (platform !== 'win') {
      const tools = await ensureClientTools(['smbclient']);
      if (!tools.ok) {
        jsonLogger.warn({ event: 'smb:validate', host: safeHost, share: safeShare, result: 'missing-tools' });
        return { valid: false, error: tools.message, reason: 'unknown' };
      }
    }

    let lastFailure: Failure = { valid: false, error: 'Unable to connect to server', reason: 'unknown' };
    let failedCandidate = safeHost;
    for (const candidate of candidates) {
      const result = await attempt(candidate);
      if (result.valid) {
        // Remember the share credentials that worked so the next wizard run prefills them.
        try {
          if (record) getCredentialManager().store(safeHost, safeShare, safeUser, password);
        } catch (e: any) {
          console.warn('Could not persist validated SMB credentials:', e?.message || e);
        }
        jsonLogger.info({ event: 'smb:validate', host: candidate, share: safeShare, result: 'ok' });
        return { valid: true, host: candidate };
      }
      lastFailure = result;
      failedCandidate = candidate;
      // Wrong credentials or a missing share will fail the same way on every address
      if (result.reason === 'auth' || result.reason === 'share') break;
    }

    if (lastFailure.reason === 'auth') {
      lastFailure = { ...lastFailure, error: 'Invalid username or password for this share.' };
    } else if (lastFailure.reason === 'share') {
      lastFailure = { ...lastFailure, error: `The share "${safeShare}" was not found on ${safeHost}.` };
    }

    jsonLogger.warn({
      event: 'smb:validate',
      host: safeHost,
      tried: candidates,
      failedOn: failedCandidate,
      share: safeShare,
      result: 'fail',
      reason: lastFailure.reason,
      error: lastFailure.error,
    });
    return lastFailure;
  });

  ipcMain.handle('credentials:retrieve', (event, { host, share, username }: { host: string; share: string; username?: string }) => {
    assertMainWindowSender(event);
    const cm = getCredentialManager();
    const safeHost = assertSafeHost(host);
    const safeShare = assertSafeShare(share);
    if (username) {
      const cred = cm.retrieve(safeHost, safeShare, assertSafeUsername(username));
      return cred ? { host: cred.host, share: cred.share, username: cred.username, found: true } : { found: false };
    }
    const cred = cm.findByHostAndShare(safeHost, safeShare);
    return cred ? { host: cred.host, share: cred.share, username: cred.username, found: true } : { found: false };
  });

  registerLogHandlers(assertMainWindowSender);

  // Scripts are generated files; without this, fixes only reach tasks the user happens to
  // run manually, since cron/launchd/Task Scheduler just execute whatever is on disk.
  void (async () => {
    const backUpManager = getBackUpManager();
    if (!backUpManager?.refreshAllTaskScripts) return;
    try {
      const upgraded = await backUpManager.refreshAllTaskScripts();
      if (upgraded > 0) jsonLogger.info({ event: 'backup:task-scripts-upgraded', count: upgraded });
    } catch (err) {
      jsonLogger.warn({ event: 'backup:task-scripts-upgrade-failed', error: String(err) });
    }
  })();

  createWindow();
  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

});

app.on('window-all-closed', () => {
  // Quit the app on Windows when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  disposeAllSSH();
});

let _backUpManager: BackUpManager | null | undefined;
function getBackUpManager(): BackUpManager | null {
  if (_backUpManager !== undefined) return _backUpManager;
  const os = getOS();
  if (os === "win") {
    _backUpManager = new BackUpManagerWin();
  } else if (os === "debian" || os == "rocky") {
    _backUpManager = new BackUpManagerLin();
  } else if (os === "mac") {
    _backUpManager = new BackUpManagerMac();
  } else {
    _backUpManager = null;
  }
  return _backUpManager;
}

