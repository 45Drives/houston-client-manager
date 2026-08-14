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
import http from 'http';
import { Server } from './types';
import mountSmbPopup from './smbMountPopup';
import { IPCRouter } from '../../houston-common/houston-common-lib/lib/electronIPC/IPCRouter';
import { getOS } from './utils';
import { v4 as uuidv4 } from 'uuid';
import { BackUpManager, BackUpManagerLin, BackUpManagerMac, BackUpManagerWin } from './backup';
import { server, unwrap } from '@45drives/houston-common-lib';
import { installServerDepsRemotely } from './installServerDeps';
import { getPin, rememberPin } from './certPins'
import { getCredentialManager } from './credentialManager';
import { assertSafeHost, assertSafeShare, assertSafeUsername } from './security';
import { checkSSH, verifySshCredentials } from './setupSsh';
import { loadSettings, saveSettings, resetSettings } from './settingsStore';
import { handleBackupMessage } from './ipc/backupHandlers';
import { handleDiscoveryMessage } from './ipc/discoveryHandlers';
import { registerLogHandlers } from './ipc/logHandlers';
import { registerRestoreHandlers } from './ipc/restoreHandlers';
import { registerTopologyHandlers } from './ipc/topologyHandlers';
import { registerBulkSetupHandlers } from './ipc/bulkSetupHandlers';
import { registerServerManageHandlers } from './ipc/serverManageHandlers';
import { registerWireWizardHandlers } from './ipc/wireWizardHandlers';
import type { IPCHandlerContext } from './ipc/types';

let discoveredServers: Server[] = [];
export let jsonLogger: ReturnType<typeof createLogger>;

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

const getLocalIP = () => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    const items = nets[name];
    if (!items) continue;

    for (const net of items) {
      if (net.family === 'IPv4' && !net.internal && isPrivateV4(net.address)) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
};


function getSubnetBase(ip: string): string {
  const parts = ip.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
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
    const ip = getLocalIP();
    const subnet = getSubnetBase(ip);
    const ips = Array
      .from({ length: 256 }, (_, i) => `${subnet}.${i}`)
      .filter(candidate => candidate !== ip);

    // scan all IPs in subnet for cockpit on port 9090
    const scanned = await Promise.allSettled(
      ips.map(async candidateIp => {


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
      })
    );

    const fallbackServers = scanned
      .map(r => r.status === 'fulfilled' ? r.value : null)
      .filter((s): s is Server => s !== null);

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
    if (
      manager &&
      (getOS() === "rocky" || getOS() === "debian") &&
      typeof manager.isFirstBackupNeeded === "function"
    ) {
      return manager.isFirstBackupNeeded(host, share, smbUser);
    }
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

  function startDiscoveryLoops() {
    if (discoveryEnabled) return;
    discoveryEnabled = true;

    const scanInterval = loadSettings().discoveryScanIntervalMs;

    mdnsInterval = setInterval(() => {
      mDNSClient.query({ questions: [{ name: serviceType, type: 'PTR' }] });
    }, scanInterval);

    clearInactiveServerInterval = setInterval(() => {
      const now = Date.now();
      const before = discoveredServers.length;

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
  registerWireWizardHandlers({ jsonLogger });

  IPCRouter.getInstance().addEventListener('action', async (data) => {
    if (data === "requestBackUpTasks") {
      const backUpManager = getBackUpManager();
      if (backUpManager) {
        const tasks = await backUpManager.queryTasks();
        console.debug('tasks found:', tasks);
        IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({ type: 'sendBackupTasks', tasks }));
        jsonLogger.info({ event: 'requestBackUpTasks', tasks });
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
  mDNSClient.query({ questions: [{ name: serviceType, type: 'PTR' }] });


  // Start listening for devices
  mDNSClient.on('response', async (response) => {
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
          if (
            discoveryEnabled &&
            !server.manuallyAdded &&
            !server.fallbackAdded
          ) {
            try {
              const fetchResponse = await fetch(`http://${server.ip}:9095/setup-status`, {
                cache: 'no-store',
                signal: AbortSignal.timeout(2000),
              });

              if (fetchResponse.ok) {
                const setupStatusResponse = await fetchResponse.json();

                if (typeof setupStatusResponse.setupComplete === 'boolean') {
                  server.setupComplete = setupStatusResponse.setupComplete;
                  server.status = setupStatusResponse.setupComplete ? 'complete' : 'not complete';
                } else if (typeof setupStatusResponse.status === 'string') {
                  server.status = setupStatusResponse.status;
                  if (server.status === 'complete') server.setupComplete = true;
                }

                server.shareName = setupStatusResponse.shareName || server.shareName;
                server.serverName = setupStatusResponse.serverName || server.serverName;
                server.setupTime = setupStatusResponse.setupTime || server.setupTime;
                server.serverInfo = {
                  moboMake: setupStatusResponse.moboMake || server.serverInfo!.moboMake,
                  moboModel: setupStatusResponse.moboModel || server.serverInfo!.moboModel,
                  serverModel: setupStatusResponse.serverModel || server.serverInfo!.serverModel,
                  aliasStyle: setupStatusResponse.aliasStyle || server.serverInfo!.aliasStyle,
                  chassisSize: setupStatusResponse.chassisSize || server.serverInfo!.chassisSize,
                };
              }
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
              // Preserve status/setupComplete when HTTP check was skipped (discovery disabled)
              status: (!discoveryEnabled && existing.status !== 'unknown') ? existing.status : server.status,
              setupComplete: (!discoveryEnabled && existing.setupComplete !== undefined) ? existing.setupComplete : server.setupComplete,
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

          break server_search;
        }
      }
    }

    if (mainWindow) {
      mainWindow.webContents.send('discovered-servers', discoveredServers);
      mainWindow.webContents.send('client-ip', getLocalIP());
    }
  });


  async function pollActions(server: Server) {
    try {
      const response = await fetch(`http://${server.ip}:9095/actions?client_ip=${getLocalIP()}`);
      const data = await response.json();

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

  ipcMain.handle('servers:add', (event, p: { host: string; shareName: string; username: string; password: string; smbUser?: string; smbPass?: string; sshKeyPath?: string; sshPassphrase?: string; name?: string; favorite?: boolean; setupComplete?: boolean }) => {
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
    const os = getOS();

    return new Promise<{ valid: boolean; error?: string }>((resolve) => {
      if (os === 'win') {
        // Use PowerShell to test SMB connection
        const ps = `$pass = ConvertTo-SecureString '${password.replace(/'/g, "''")}' -AsPlainText -Force; $cred = New-Object System.Management.Automation.PSCredential('${safeUser}', $pass); try { New-PSDrive -Name HTest -PSProvider FileSystem -Root "\\\\${safeHost}\\${safeShare}" -Credential $cred -ErrorAction Stop | Out-Null; Remove-PSDrive -Name HTest; Write-Output 'OK' } catch { Write-Output "FAIL:$($_.Exception.Message)" }`;
        execFileCb('powershell', ['-NoProfile', '-Command', ps], { timeout: 15000 }, (err: any, stdout: string) => {
          if (err || !stdout.trim().startsWith('OK')) {
            const detail = stdout?.trim().replace(/^FAIL:/, '') || err?.message || 'Connection failed';
            resolve({ valid: false, error: detail });
          } else {
            resolve({ valid: true });
          }
        });
      } else {
        // Use smbclient to validate credentials on Linux/macOS
        const args = ['-L', `//${safeHost}`, '-U', `${safeUser}%${password}`, '-g'];
        execFileCb('smbclient', args, { timeout: 15000 }, (err: any, stdout: string, stderr: string) => {
          const output = `${stdout}\n${stderr}`;
          if (/NT_STATUS_LOGON_FAILURE|NT_STATUS_ACCESS_DENIED/i.test(output)) {
            resolve({ valid: false, error: 'Invalid username or password' });
          } else if (err && !/Disk\|/i.test(stdout)) {
            // smbclient returns non-zero but may still list shares
            resolve({ valid: false, error: 'Unable to connect to server' });
          } else {
            resolve({ valid: true });
          }
        });
      }
    });
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

