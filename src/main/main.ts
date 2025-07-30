import log from 'electron-log';
log.transports.console.level = false;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
// process.env.NODE_ENV = 'development';
console.log = (...args) => log.info(...args);
console.error = (...args) => log.error(...args);
console.warn = (...args) => log.warn(...args);
console.debug = (...args) => log.debug(...args);

process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path, { join } from 'path';
import mdns from 'multicast-dns';
import os from 'os';
import fs from 'fs';
import net from 'net';
import { Server } from './types';
import mountSmbPopup from './smbMountPopup';
import { IPCRouter } from '../../houston-common/houston-common-lib/lib/electronIPC/IPCRouter';
import { getOS } from './utils';
import { BackUpManager, BackUpManagerLin, BackUpManagerMac, BackUpManagerWin, BackUpSetupConfigurator } from './backup';
import { BackUpSetupConfig, BackUpTask, server, unwrap } from '@45drives/houston-common-lib';
import fetchBackups from './backup/FetchBackups';
import fetchFilesInBackup from './backup/FetchFilesFromBackup';
import restoreBackups from './backup/RestoreBackups';
import { checkBackupTaskStatus } from './backup/CheckSmbStatus';
import { installServerDepsRemotely } from './installServerDeps';
import { checkSSH } from './setupSsh';

let discoveredServers: Server[] = [];

// const blockerId = powerSaveBlocker.start("prevent-app-suspension");

app.commandLine.appendSwitch('ignore-certificate-errors', 'true');

const platform = getOS();

function checkLogDir(): string {
  let logDir = '';

  const isRoot = process.getuid?.() === 0; // On Windows, this will be undefined

  try {
    switch (platform) {
      case 'win':   // e.g. C:\ProgramData\houston-backups\logs
        logDir = path.join(
          process.env.ProgramData || 'C:\\ProgramData',
          'houston-backups',
          'logs'
        );
        break;

      case 'mac':   // follow macOS conventions
        logDir = isRoot
          ? '/Library/Logs/houston'                           // system-wide
          : path.join(app.getPath('home'), 'Library/Logs', 'houston'); // per-user
        break;

      default:      // Linux / BSD
        logDir = isRoot
          ? '/var/log/houston'
          : path.join(app.getPath('userData'), 'logs');
        break;
    }  

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    console.log(`✅ Log directory ensured: ${logDir}`);
  } catch (error: any) {
    console.error(`❌ Failed to create log directory (${logDir}):`, error.message);
  }

  return logDir;
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

// Timeout duration in milliseconds (e.g., 30 seconds)
const TIMEOUT_DURATION = 10000;
const serviceType = '_houstonserver._tcp.local'; // Define the service you're looking for

const getLocalIP = () => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    const something = nets[name];
    if (something) {
      for (const net of something) {
        // Only return the IPv4 address (ignoring internal/loopback addresses)
        if (net.family === "IPv4" && !net.internal && net.address.startsWith("192")) {
          return net.address;
        }
      }
    }
  }
  
  return "127.0.0.1"; // Fallback
};


function getSubnetBase(ip: string): string {
  const parts = ip.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}


function createWindow() {
  const mainWindow = new BrowserWindow({
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

    // exactly your old logic, with proper serverInfo defaults
    const scanned = await Promise.allSettled(
      ips.map(async candidateIp => {

        // console.log("checking for server at ", candidateIp);

        const portOpen = await isPortOpen(candidateIp, 9090);
        if (!portOpen) return null;
        console.log("port open at 9090 ", candidateIp);
        
        try {
          const res = await fetch(`https://${candidateIp}:9090/`, {
            method: 'GET',
            cache: 'no-store',
            signal: AbortSignal.timeout(3000),
            
          });
          if (!res.ok) return null;

          console.log("https at 9090 ", candidateIp);
          
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
      mainWindow.webContents.send('discovered-servers', discoveredServers);
    }

    return fallbackServers;
  }

  IPCRouter.initBackend(mainWindow.webContents, ipcMain);

  let rendererIsReady = false;
  let bufferedNotifications: string[] = [];

  ipcMain.on("renderer-ready", (event) => {
    rendererIsReady = true;
    bufferedNotifications.forEach(msg => {
      event.sender.send("notification", msg);
    });
    bufferedNotifications = [];
  });

  ipcMain.handle('install-cockpit-module', async (_event, { host, username, password }) => {
    // 4. Store manual creds for login UI (if needed)
    mainWindow.webContents.send('store-manual-creds', {
      ip: host,
      username,
      password,
    });

    try {
      const res = await installServerDepsRemotely({ host, username, password });
      console.log("✅ install-cockpit-module →", res);
      return res;
    } catch (err) {
      console.error("❌ install-cockpit-module error:", err);
      throw err;            // so the renderer gets the real stack
    }
  });
  
  ipcMain.handle('get-os', () => getOS());

  ipcMain.handle("backup:isFirstRunNeeded", (_evt, host, share) => {
    const manager = getBackUpManager();
    if (
      manager &&
      (getOS() === "rocky" || getOS() === "debian") &&
      typeof manager.isFirstBackupNeeded === "function"
    ) {
      return manager.isFirstBackupNeeded(host, share); // MUST RETURN
    }

    return false;
  });

  
  ipcMain.handle('scan-network-fallback', async () => {
    return await doFallbackScan();
  });

  function notify(message: string) {
    // console.log("[Main] 🔔 notify() called with:", message);

    if (!mainWindow || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) {
      console.warn("[Main] ❌ mainWindow/webContents not ready");
      return;
    }
    
    if (rendererIsReady && mainWindow?.webContents) {
      mainWindow.webContents.send("notification", message);
    } else {
      bufferedNotifications.push(message);
    }
  }
  

  IPCRouter.getInstance().addEventListener('action', async (data) => {
    // console.log('action data:', data);
    if (data === "requestBackUpTasks") {
      let backUpManager: BackUpManager | null = getBackUpManager();

      if (backUpManager) {
        const tasks = await backUpManager.queryTasks();
        console.log('tasks found:', tasks);
        IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({
          type: 'sendBackupTasks',
          tasks
        }));
      }
    } else if (data === "requestHostname") {
      IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({
        type: "sendHostname",
        hostname: await unwrap(server.getHostname())
      }));
    } 
    else {
      try {
        // console.log("[Main] 📩 Raw message received:", data);

        const message = JSON.parse(data);
        // console.log("[Main] 📩 Parsed message:", message);
        if (message.type === 'configureBackUp') {

          message.config.backUpTasks.forEach(backUpTask => {

            backUpTask.schedule.startDate = new Date(backUpTask.schedule.startDate);
          })

          const config: BackUpSetupConfig = message.config;

          new BackUpSetupConfigurator().applyConfig(config, (progress) => {
            IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({
              type: "backUpSetupStatus",
              status: progress
            }));
          })
        } else if (message.type === 'fetchBackupsFromServer') {

          IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({
            type: "fetchBackupsFromServerResult",
            result: await fetchBackups(message.data, mainWindow)
          }));

        } else if (message.type === 'fetchFilesFromBackup') {

          IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({
            type: "fetchFilesFromBackupResult",
            result: await fetchFilesInBackup(message.data)
          }));

        } else if (message.type === 'restoreBackups') {

          await restoreBackups(message.data, IPCRouter.getInstance())

        } else if (message.type === 'removeBackUpTask') {
          const task: BackUpTask = message.task;
          const backupManager = getBackUpManager();

          if (!backupManager) {
            notify(`Error: No Backup Manager available.`);
            return;
          }

          try {
            await backupManager.unschedule(task);
            notify(`🗑️ Successfully removed ${task.source} → ${task.target}`);

            // 🔄 After deletion, re-send updated tasks
            const tasks = await backupManager.queryTasks();

            IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({
              type: 'sendBackupTasks',
              tasks
            }));
          } catch (err: any) {
            notify(`Error deleting task: ${err.message}`);
            console.error("removeBackUpTask failed:", err);
          }
        } else if (message.type === 'removeMultipleBackUpTasks') {
          const tasks: BackUpTask[] = message.tasks;
          const backupManager = getBackUpManager();

          if (!backupManager) {
            notify(`Error: No Backup Manager available.`);
            return;
          }

          try {
            if (backupManager?.unscheduleSelectedTasks) {
              await backupManager.unscheduleSelectedTasks(tasks);

              notify(`Successfully removed ${tasks.length} backup task(s)!`);

              const updatedTasks = await backupManager.queryTasks();
              IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({
                type: 'sendBackupTasks',
                tasks: updatedTasks
              }));

            } else {
              notify(`Error: Backup Manager does not support bulk deletion.`);
            }
          } catch (err: any) {
            notify(`Error: ${err.message}`);
            console.error("removeMultipleBackUpTasks failed:", err);
          }
        } else if (message.type === 'updateBackUpTask') {
          const task: BackUpTask = message.task;
          const username: string = message.username;
          const password: string = message.password;
          const backupManager = getBackUpManager();

          if (!backupManager) {
            notify(`Error: No Backup Manager available.`);
            return;
          }

          try {
            await backupManager.updateSchedule(task, username, password);
            const date = new Date(task.schedule.startDate);
            const minute = date.getMinutes().toString().padStart(2, '0');
            const hour = date.getHours();
            notify(`Updated cron schedule for ${task.description} to ${hour}:${minute}`);
          } catch (err: any) {
            notify(`Error: ${err.message}`);
            console.error("updateBackUpTask failed:", err);
          }
        } else if (message.type === 'openFolder') {
          // console.log('Attempting to open folder path:', message.path);
          // const folderPath: string = message.path;
          // try {
          //   console.log('🧪 Trying to open folder:', folderPath);
          //   console.log('✅ Exists:', fs.existsSync(folderPath));
          //   shell.openPath(folderPath).then(result => {
          //     if (result) {
          //       notify(`❌ Error opening folder: ${result}`);
          //     } else {
          //       notify(`📂 Opened folder: ${folderPath}`);
          //     }
          //   });
          // } catch (err) {
          //   notify(`Error: Failed to open folder: ${folderPath}`);
          //   console.error("Error opening folder:", folderPath, err);
          // }

          const folderPath: string = message.path;
          try {
            console.log('🧪 Trying to open folder:', folderPath);

            const exists = fs.existsSync(folderPath);
            console.log('✅ Exists:', exists);

            if (!exists) {
              notify(`❌ Folder does not exist: ${folderPath}`);
              return;
            }

            const stats = fs.statSync(folderPath);
            if (!stats.isDirectory()) {
              notify(`❌ Not a directory: ${folderPath}`);
              return;
            }

            shell.openPath(folderPath).then(result => {
              if (result) {
                console.error(`❌ shell.openPath failed:`, result);
                notify(`❌ Error opening folder: ${result}`);
              } else {
                notify(`📂 Opened folder: ${folderPath}`);
              }
            });
          } catch (err) {
            notify(`❌ Exception while opening folder: ${folderPath}`);
            console.error("Error opening folder:", folderPath, err);
          }

        } else if (message.type === 'checkBackUpStatuses') {
          // console.log("✅ Received checkBackUpStatuses")
          const tasks: BackUpTask[] = message.tasks;
          const updatedTasks: BackUpTask[] = [];
          for (const task of tasks) {
            try {
              task.status = await checkBackupTaskStatus(task);
            } catch (err) {
              console.error(`Status check failed for task: ${task.description}`, err);
              task.status = 'offline_connection_error';
            }
            updatedTasks.push(task); 
          }

          IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({
            type: 'backUpStatusesUpdated',
            tasks: updatedTasks
          }));
        } else if (message.type === 'requestBackUpTasksWithStatus') {
          const backUpManager = getBackUpManager();
          try {
            if (backUpManager !== null) {
              const tasks = await backUpManager.queryTasks();

              for (const task of tasks) {
                try {
                  task.status = await checkBackupTaskStatus(task);
                } catch (err) {
                  console.error(`Failed to check status for ${task.description}:`, err);
                  task.status = 'offline_connection_error';
                }
              }

              IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({
                type: 'sendBackupTasks',
                tasks
              }));
            }

            const backupManager = getBackUpManager();
            if (!backupManager) {
             notify(`Error: No Backup Manager available.`);
              return;
            }
          } catch (err: any) {
           notify(`Error: ${err.message}`);
            console.error("updateBackUpTask failed:", err);
          }

        } else if (message.type === 'runBackUpTaskNow') {
          const backupManager = getBackUpManager();
          const task: BackUpTask = message.task;

          if (!backupManager || typeof (backupManager as any).runNow !== 'function') {
           notify(`Error: Run Now not supported for this OS`);
            return;
          }

          try {
            console.log("▶️ Attempting to run backup:", task.description);
            const result = await (backupManager as any).runNow(task);

            if (result.stderr && result.stderr.trim() !== "") {
              console.warn("⚠️ Backup completed with warnings/errors in stderr:", result.stderr);
            }

            console.log("✅ runNow completed:", result);
            notify(`✅ Backup task "${task.description}" started successfully.`);

            setTimeout(async () => {
              try {
                task.status = await checkBackupTaskStatus(task);
                IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({
                  type: 'backUpStatusesUpdated',
                  tasks: [task]
                }));
              } catch (err) {
                console.warn(`Post-runNow status update failed for ${task.description}`, err);
              }
            }, 5000);
          } catch (err: any) {
            console.error("❌ runNow failed:", err);
            const errorMsg = err?.stderr || err?.message || JSON.stringify(err);
            notify(`❌ Backup task "${task.description}" failed to run: ${errorMsg}`);
          }

        } else if (message.type === 'addManualIP') {
          const { ip, manuallyAdded } = message as { ip: string; manuallyAdded?: boolean };

          // 1) Try Cockpit’s HTTPS on 9090, but DON’T let a throw skip the SSH probe
          let httpsReachable = false;
          try {
            const res = await fetch(`https://${ip}:9090/`, {
              method: 'GET',
              cache: 'no-store',
              signal: AbortSignal.timeout(3000),
            });
            httpsReachable = res.ok;
            // console.log('HTTPS check:', res.ok ? 'OK' : `status ${res.status}`);
          } catch (err) {
            console.warn('HTTPS check failed:', err);
          }

          // 2) If no HTTPS, fall back to SSH
          let reachable = httpsReachable;
          if (!reachable) {
            // console.log('Falling back to SSH probe on port 22…');
            reachable = await checkSSH(ip, 3000);
            // console.log(`SSH probe ${reachable ? 'succeeded' : 'failed'}`);
          }

          // 3) If _still_ unreachable, bail
          if (!reachable) {
            return notify(`Error: Unable to reach ${ip} via HTTPS (9090) or SSH (22)`);
          }

          // 4) success! add to discoveredServers
          const server: Server = {
            ip,
            name: ip,
            status: 'unknown',
            setupComplete: false,
            lastSeen: Date.now(),
            serverName: ip,
            shareName: '',
            setupTime: '',
            serverInfo: {
              moboMake: '',
              moboModel: '',
              serverModel: '',
              aliasStyle: '',
              chassisSize: '',
            },
            manuallyAdded: manuallyAdded === true,
            fallbackAdded: false,
          };

          // let existingServer = discoveredServers.find((eServer) => eServer.ip === server.ip && eServer.name === server.name);
          let existingServer = discoveredServers.find(eServer => eServer.ip === server.ip);

          try {
            if (!existingServer) {
              discoveredServers.push(server);
            } else {
              existingServer.lastSeen = Date.now();
              existingServer.status = server.status;
              existingServer.setupComplete = server.status == 'complete' ? true : false;
              existingServer.serverName = server.serverName;
              existingServer.shareName = server.shareName;
              existingServer.setupTime = server.setupTime;
              existingServer.serverInfo = server.serverInfo;
            }

          } catch (error) {
            console.error('Add Manual Server-> Fetch error:', error);
          }

          mainWindow.webContents.send('discovered-servers', discoveredServers);

        } else if (message.type === 'rescanServers') {
          // clear & notify
          discoveredServers = [];
          mainWindow.webContents.send('discovered-servers', discoveredServers);

          // kick mDNS
          mDNSClient.query({ questions: [{ name: serviceType, type: 'PTR' }] });

          // after timeout: if still empty, call the same fallback fn
          setTimeout(async () => {
            if (discoveredServers.length === 0) {
              const fallback = await doFallbackScan();
              if (fallback.length) {
                mainWindow.webContents.send('discovered-servers', fallback);
              }
            }
          }, TIMEOUT_DURATION);
        }
      
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
        const ipAnswer = records.find(a => a.type === 'A' && a.name === (answer1.data as any).target);
        const txtAnswer = records.find(a => a.type === 'TXT' && a.name === answer1.name);

        if (ipAnswer && ipAnswer.data) {
          const serverIp = ipAnswer.data as string;
          const instance = answer1.name;    // e.g. "hl4-test._houstonserver._tcp.local"

          // Parse TXT into a map
          const txtRecord: Record<string, string> = {};
          if (txtAnswer && Array.isArray(txtAnswer.data)) {
            txtAnswer.data.forEach((buf: Buffer) => {
              const [k, v] = buf.toString().split('=');
              txtRecord[k] = v;
            });
          }

          // Derive a friendly name (strip off the "._houstonserver._tcp.local" suffix)
          const [bare] = instance.split('._');
          const displayName = `${bare}.local`;

          // Build your Server exactly as before, using displayName
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

          if (!server.manuallyAdded && !server.fallbackAdded) {
            try {
              const fetchResponse = await fetch(`http://${server.ip}:9095/setup-status`);
              if (fetchResponse.ok) {
                const setupStatusResponse = await fetchResponse.json();
                server.status = setupStatusResponse.status ?? 'unknown';
              } else {
                console.warn(`HTTP error! server: ${server.name} status: ${fetchResponse.status}`);
              }
            } catch (error) {
              // console.error('Server Search -> Fetch error:', error);
            }
          }

          // upsert into discoveredServers
          // const existing = discoveredServers.find(s => s.ip === server.ip && s.name === server.name);
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

  const mdnsInterval = setInterval(() => {
    mDNSClient.query({
      questions: [{ name: '_houstonserver._tcp.local', type: 'PTR' }],
    })
  }, 5000);


  const clearInactiveServerInterval = setInterval(() => {
    const now = Date.now()

    // only keep servers that are still “fresh” OR that have manuallyAdded === true
    discoveredServers = discoveredServers.filter(srv =>
      now - srv.lastSeen <= TIMEOUT_DURATION
      || (srv as any).manuallyAdded === true
    )

    // push the updated list back to the renderer
    mainWindow.webContents.send('discovered-servers', discoveredServers)
  }, 5000)
  

  async function pollActions(server: Server) {
    try {
      const response = await fetch(`http://${server.ip}:9095/actions?client_ip=${getLocalIP()}`);
      const data = await response.json();

      if (data.action) {
        // console.log("New action received:", server, data);

        if (data.action === "mount_samba_client") {
          mountSmbPopup(data.smb_host, data.smb_share, data.smb_user, data.smb_pass, mainWindow);
        } else {
          console.log("Unknown new actions.", server);
        }
      }
    } catch (error) {
      // console.error(`❌ [pollActions] fetch failed for ${server.ip}`, error);
    }
  }

  IPCRouter.getInstance().addEventListener('mountSambaClient', async (data) => {
    let result
    try {
     result = await mountSmbPopup(data.smb_host, data.smb_share, data.smb_user, data.smb_pass, mainWindow, "popup");

    } catch (e: any) {
      result = { error: e && e.message ? e.message : "Failed to mount" };
    }
    // console.log('mountSambaClient result:', result);
    IPCRouter.getInstance().send("renderer", "action", JSON.stringify({
      action: "mountSmbResult",
      result: result
    }))
  });

  const pollActionInterval = setInterval(async () => {
    for (let server of discoveredServers) {
      if ((server as any).manuallyAdded || (server as any).fallbackAdded) continue
      await pollActions(server)
    }
  }, 5000);


  app.on('window-all-closed', function () {
    ipcMain.removeAllListeners('message')
    clearInterval(pollActionInterval);
    clearInterval(clearInactiveServerInterval);
    clearInterval(mdnsInterval);
    mDNSClient.destroy();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (_wawevent, webPreferences, _params) => {
    webPreferences.preload = `${__dirname}/webview-preload.js`;
  });
});


app.whenReady().then(() => {
  const resolvedLogDir = checkLogDir();

  log.transports.file.resolvePathFn = () => path.join(resolvedLogDir, 'main.log');
  log.info("🟢 Logging initialized.");
  log.info("Log file path:", log.transports.file.getFile().path);

  ipcMain.handle("is-dev", async () => process.env.NODE_ENV === 'development');


  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'], // Opens folder selection dialog
    });

    return result.canceled ? null : result.filePaths[0]; // Return full folder path
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
  // ✅ This ensures your app fully quits on Windows
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function getBackUpManager() {
  const os = getOS();
  let backUpManager: BackUpManager | null = null;
  if (os === "win") {
    backUpManager = new BackUpManagerWin();
  } else if (os === "debian" || os == "rocky") {
    backUpManager = new BackUpManagerLin();
  } else if (os === "mac") {
    backUpManager = new BackUpManagerMac();
  }
  return backUpManager;

}

