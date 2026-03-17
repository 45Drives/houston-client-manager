import log from 'electron-log';
log.transports.console.level = false;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Noise-filtered console overrides (TLS warnings, APPIMAGE)
const SUPPRESS_PATTERNS = ['APPIMAGE env is not defined', 'NODE_TLS_REJECT_UNAUTHORIZED'];
const isSuppressed = (args: any[]) => {
  const msg = args.map(String).join(' ');
  return SUPPRESS_PATTERNS.some(p => msg.includes(p));
};
// Initial console routing through electron-log (upgraded in app.whenReady with jsonLogger)
console.log = (...args) => log.info(...args);
console.error = (...args) => { if (!isSuppressed(args)) log.error(...args); };
console.warn = (...args) => { if (!isSuppressed(args)) log.warn(...args); };
console.debug = (...args) => log.debug(...args);

process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron';
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
import { Server } from './types';
import mountSmbPopup from './smbMountPopup';
import { IPCRouter } from '../../houston-common/houston-common-lib/lib/electronIPC/IPCRouter';
import { getOS } from './utils';
import { v4 as uuidv4 } from 'uuid';
import { BackUpManager, BackUpManagerLin, BackUpManagerMac, BackUpManagerWin, BackUpSetupConfigurator } from './backup';
import { BackUpSetupConfig, BackUpTask, server, unwrap } from '@45drives/houston-common-lib';
import fetchBackups from './backup/FetchBackups';
import fetchFilesInBackup from './backup/FetchFilesFromBackup';
import restoreBackups from './backup/RestoreBackups';
import { checkBackupTaskStatus } from './backup/CheckSmbStatus';
import { installServerDepsRemotely } from './installServerDeps';
import { checkSSH } from './setupSsh';
import { getPin, isHostPinned, rememberPin } from './certPins'
import { getCredentialManager } from './credentialManager';
import { assertSafeHost, assertSafeShare, assertSafeUsername } from './security';
import { handleBackupMessage } from './ipc/backupHandlers';
import { handleDiscoveryMessage } from './ipc/discoveryHandlers';
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

// OAuth popup: open a real BrowserWindow so postMessage works
ipcMain.handle('oauth:open', async (_event, url: string) => {
  // Use a dedicated session partition so the OAuth window doesn't trigger
  // the TOFU cert-pinning prompts from the default session.
  const oauthSession = session.fromPartition('persist:oauth');

  const win = new BrowserWindow({
    width: 520,
    height: 920,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      session: oauthSession,
    },
  });

  let resolved = false;
  let resolvePromise: (val: any) => void;
  const promise = new Promise<any>((r) => { resolvePromise = r; });

  const OPENER_POLYFILL = `
    (function() {
      if (window.__oauthPatched) return;
      window.__oauthPatched = true;
      if (!window.opener) {
        Object.defineProperty(window, 'opener', {
          value: {
            postMessage: function(data) {
              console.log('__OAUTH_TOKEN__:' + JSON.stringify(data));
            }
          },
          configurable: true
        });
      }
    })();
  `;

  function handleTokenMessage(_e: any, _level: any, message: string) {
    if (resolved) return;
    if (typeof message === 'string' && message.startsWith('__OAUTH_TOKEN__:')) {
      try {
        const data = JSON.parse(message.slice('__OAUTH_TOKEN__:'.length));
        resolved = true;
        resolvePromise({ success: true, token: data });
        try { win.close(); } catch {}
      } catch { /* ignore parse errors */ }
    }
  }

  // Polyfill window.opener on every page load in the main OAuth window
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(OPENER_POLYFILL).catch(() => {});
  });
  win.webContents.on('console-message', handleTokenMessage);
  win.on('closed', () => { if (!resolved) resolvePromise({ success: false }); });

  // Handle child popups (e.g. "Sign in with Google" from Dropbox's page)
  win.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
    const child = new BrowserWindow({
      width: 500,
      height: 700,
      parent: win,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: oauthSession,
      },
    });
    child.loadURL(popupUrl);
    child.webContents.on('dom-ready', () => {
      child.webContents.executeJavaScript(OPENER_POLYFILL).catch(() => {});
    });
    child.webContents.on('console-message', (_e: any, _level: any, msg: string) => {
      if (resolved) return;
      if (typeof msg === 'string' && msg.startsWith('__OAUTH_TOKEN__:')) {
        try {
          const data = JSON.parse(msg.slice('__OAUTH_TOKEN__:'.length));
          resolved = true;
          resolvePromise({ success: true, token: data });
          try { child.close(); } catch {}
          try { win.close(); } catch {}
        } catch { /* ignore */ }
      }
    });
    return { action: 'deny' }; // we opened it manually
  });

  win.loadURL(url);
  return promise;
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

// Timeout duration in milliseconds (e.g., 60 seconds)
const TIMEOUT_DURATION = 60_000;
const serviceType = '_houstonserver_legacy._tcp.local';

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

  ipcMain.handle('install-cockpit-module', async (event, { host, username, password }) => {
    assertMainWindowSender(event);
    // 4. Store manual creds for login UI (if needed)
    mainWindow!.webContents.send('store-manual-creds', {
      ip: host,
      username,
      password,
    });

    try {
      const res = await installServerDepsRemotely({ host, username, password });
      console.debug(" install-cockpit-module →", res);
      return res;
    } catch (err) {
      console.error(" install-cockpit-module error:", err);
      throw err;            // so the renderer gets the real stack
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

  let discoveryEnabled = false;
  let mdnsInterval: NodeJS.Timeout | null = null;
  let pollActionInterval: NodeJS.Timeout | null = null;
  let clearInactiveServerInterval: NodeJS.Timeout | null = null;

  function startDiscoveryLoops() {
    if (discoveryEnabled) return;
    discoveryEnabled = true;

    mdnsInterval = setInterval(() => {
      mDNSClient.query({ questions: [{ name: serviceType, type: 'PTR' }] });
    }, 5000);

    clearInactiveServerInterval = setInterval(() => {
      const now = Date.now();
      const before = discoveredServers.length;

      discoveredServers = discoveredServers.filter(srv =>
        now - srv.lastSeen <= TIMEOUT_DURATION || srv.manuallyAdded === true
      );

      if (discoveredServers.length !== before) {
        mainWindow!.webContents.send('discovered-servers', discoveredServers);
      }
    }, 5000);

    pollActionInterval = setInterval(() => {
      const servers = discoveredServers.filter(s =>
        !s.manuallyAdded &&
        !s.fallbackAdded &&
        s.ip !== '127.0.0.1'
      );

      // run in parallel so one slow/offline host doesn't stall the whole loop
      void Promise.allSettled(servers.map(s => pollActions(s)));
    }, 5000);
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

    if (rendererIsReady) {
      mainWindow.webContents.send("notification", message);
      try {
        IPCRouter.getInstance().send(
          'renderer', 'action',
          JSON.stringify({ type: 'notification', message })
        );
      } catch (e) { console.debug('IPCRouter notification relay failed:', e); }
    }
  }


  const handlerCtx: IPCHandlerContext = {
    getBackUpManager,
    notify,
    jsonLogger,
    mainWindow: mainWindow!,
  };

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

        if (await handleBackupMessage(message, handlerCtx)) return;

        const discoveryCtx = {
          discoveredServers,
          mainWindow: mainWindow!,
          notify,
          mDNSClient,
          serviceType,
          TIMEOUT_DURATION,
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
    const rendererPort = process.argv[2];

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

          const instance = answer1.name;    // e.g. "hl4-test._houstonserver_legacy._tcp.local"

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
              const fetchResponse = await fetch(`http://${server.ip}:9099/setup-status`, {
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
            } catch (error) {
              // This is expected when 9099 isn't up; use debug instead of warn
              console.debug(
                `setup-status fetch failed for ${server.ip}:9099; using mDNS TXT only`,
                error
              );
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
              status: server.status,
              setupComplete: server.setupComplete,
              serverName: server.serverName,
              shareName: server.shareName,
              setupTime: server.setupTime,
              serverInfo: server.serverInfo,
              fallbackAdded: false
            });
          }

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
      const response = await fetch(`http://${server.ip}:9099/actions?client_ip=${getLocalIP()}`);
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
  log.transports.file.resolvePathFn = () =>
    path.join(resolvedLogDir, 'main.log');
  log.info("🟢 Logging initialized.");
  log.info("Log file path:", log.transports.file.getFile().path);


  const { combine, timestamp, json } = format;

  // only let through events (which all have an "event" field)
  const preserveEventsOrErrors = format((info) => {
    // keep if it's an error or warning,
    // or if we've attached an "event" property
    if (['error', 'warn'].includes(info.level) || info.event) {
      return info;
    }
    return false;
  });

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
      // Redact sensitive fields before writing to disk
      format((info) => scrubValue(info))(),
      format.json()
    ),
    transports: [
      new DailyRotateFile({
        dirname: resolvedLogDir,
        filename: '45drives-setup-wizard-%DATE%.json',
        datePattern: 'YYYY-MM-DD',
        maxFiles: '14d',
        zippedArchive: true,
      })
    ]
  });


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
  
  // Monkey‐patch so calls go to both electron-log + jsonLogger
  console.log = (...args: any[]) => {
    log.info(...args);
    jsonLogger.info({ message: scrubString(args.map(String).join(' ')) });
  };
  console.warn = (...args: any[]) => {
    if (!isSuppressed(args)) {
      log.warn(...args);
      jsonLogger.warn({ message: scrubString(args.map(String).join(' ')) });
    }
  };
  console.error = (...args: any[]) => {
    if (!isSuppressed(args)) {
      log.error(...args);
      jsonLogger.error({ message: scrubString(args.map(String).join(' ')) });
    }
  };
  console.debug = (...args: any[]) => {
    log.debug(...args);
    jsonLogger.debug({ message: scrubString(args.map(String).join(' ')) });
  };

  process.on('uncaughtException', (err) => {
    log.error('Uncaught Exception:', err);
    jsonLogger.error({ event: 'uncaughtException', error: err.stack || err.message });
  });

  process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled Rejection at:', promise, 'reason:', reason);
    jsonLogger.error({ event: 'unhandledRejection', reason, promise: String(promise) });
  });

  // Auto-updates are now handled by src/main/updates.ts
  initAutoUpdates(() => mainWindow);

  ipcMain.handle('session:clear-origin', async (_event, origin: string) => {
    try {
      const sess = session.fromPartition('persist:authSession');
      await sess.clearStorageData({
        origin,
        storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers'],
      });
    } catch (e) {
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

  // ── Server Credential IPC (replaces keytar-based creds.ipc) ────────
  ipcMain.handle('cred:list-servers', (event) => {
    assertMainWindowSender(event);
    return getCredentialManager().listServers();
  });

  ipcMain.handle('cred:get-for', (event, host: string) => {
    assertMainWindowSender(event);
    return getCredentialManager().getForHost(assertSafeHost(host));
  });

  ipcMain.handle('cred:save', (event, p: { host: string; name?: string; username: string; password: string; favorite?: boolean }) => {
    assertMainWindowSender(event);
    const id = getCredentialManager().storeServer(
      assertSafeHost(p.host),
      assertSafeUsername(p.username),
      p.password,
      { name: p.name, favorite: p.favorite }
    );
    return { ok: true, id };
  });

  ipcMain.handle('cred:remove', (event, id: string) => {
    assertMainWindowSender(event);
    getCredentialManager().removeById(id);
    return { ok: true };
  });

  ipcMain.handle('cred:set-favorite', (event, id: string, fav: boolean) => {
    assertMainWindowSender(event);
    getCredentialManager().setFavorite(id, fav);
    return { ok: true };
  });

  ipcMain.handle('cred:touch', (event, id: string) => {
    assertMainWindowSender(event);
    getCredentialManager().touch(id);
    return { ok: true };
  });

  // ── Credential Manager IPC (encrypted vault) ──────────────────────────
  ipcMain.handle('credentials:store', (event, { host, share, username, password }: { host: string; share: string; username: string; password: string }) => {
    assertMainWindowSender(event);
    const safeHost = assertSafeHost(host);
    const safeShare = assertSafeShare(share);
    const safeUser = assertSafeUsername(username);
    getCredentialManager().store(safeHost, safeShare, safeUser, password);
    return { success: true };
  });

  ipcMain.handle('credentials:list', (event, { host }: { host?: string } = {}) => {
    assertMainWindowSender(event);
    const cm = getCredentialManager();
    return host ? cm.listForHost(assertSafeHost(host)) : cm.list();
  });

  ipcMain.handle('credentials:remove', (event, { host, share, username }: { host: string; share: string; username: string }) => {
    assertMainWindowSender(event);
    const removed = getCredentialManager().remove(
      assertSafeHost(host),
      assertSafeShare(share),
      assertSafeUsername(username)
    );
    return { success: removed };
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

