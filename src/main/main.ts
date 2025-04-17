import { app, BrowserWindow, ipcMain, dialog, powerSaveBlocker } from 'electron';
import { join } from 'path';
import mdns from 'multicast-dns';
import os from 'os';
import { Server } from './types';
import mountSmbPopup from './smbMountPopup';
import { IPCRouter } from '../../houston-common/houston-common-lib/lib/electronIPC/IPCRouter';
import { getOS } from './utils';
import { BackUpManager, BackUpManagerLin, BackUpManagerMac, BackUpManagerWin, BackUpSetupConfigurator } from './backup';
import { BackUpSetupConfig, BackUpTask } from '@45drives/houston-common-lib';
import { setupSsh } from './setupSsh';

let discoveredServers: Server[] = [];

const blockerId = powerSaveBlocker.start("prevent-app-suspension");

app.commandLine.appendSwitch('ignore-certificate-errors', 'true');

// app.commandLine.appendSwitch("disable-background-timer-throttling", 'true');
// app.commandLine.appendSwitch("disable-renderer-backgrounding", "true");
// app.commandLine.appendSwitch("disable-backgrounding-occluded-windows", 'true');
// app.commandLine.appendSwitch("use-gl", "desktop");

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
        if (net.family === "IPv4" && !net.internal) {
          return net.address;
        }
      }
    }
  }
  return "127.0.0.1"; // Fallback
};

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
      webSecurity: false,
      backgroundThrottling: false,  // Disable throttling
      partition: 'persist:your-cookie-partition'
    }
  });


  IPCRouter.initBackend(mainWindow.webContents, ipcMain);

  IPCRouter.getInstance().addEventListener('action', async (data) => {

    if (data === "requestBackUpTasks") {
      let backUpManager: BackUpManager | null = getBackUpManager();

      if (backUpManager !== null) {
        IPCRouter.getInstance().send('renderer', 'sendBackupTasks', await backUpManager.queryTasks());
      }
    } else {
      try {
        const message = JSON.parse(data);
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
        } else if (message.type === 'removeBackUpTask') {
          const task: BackUpTask = message.task

          const backupManager = getBackUpManager();
          if (backupManager) {
            // console.log('unscheduling task:', task)
            backupManager.unschedule(task)
            mainWindow.webContents.send('notification', `Successfully removed ${task.source}->${task.target}!`);
          } else {

            mainWindow.webContents.send('notification', `Error: No Backup Manager was found able to handle this!`);
          }

        }
      } catch (error) {

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
    // mainWindow.setMenu(null);

    mainWindow.loadFile(join(app.getAppPath(), 'renderer', 'index.html'));
  }

  mainWindow.webContents.send('client-ip', getLocalIP());

  // Set up mDNS for service discovery
  const mDNSClient = mdns(); // Correctly call as a function

  // Start listening for devices
  mDNSClient.on('response', async (response) => {

    server_search:
    for (const answer1 of response.answers) {
      if (answer1.type === 'SRV' && answer1.name.includes(serviceType)) {

        // Find related 'A' and 'TXT' records in the same response
        const ipAnswer = response.answers.find(a => a.type === 'A');
        const txtAnswer = response.answers.find(a => a.type === 'TXT');

        if (ipAnswer && ipAnswer.data) {
          const serverIp = ipAnswer.data;
          const serverName = ipAnswer.name;

          // Parse txt record fields if present
          const txtRecord: Record<string, string> = {};
          if (txtAnswer && txtAnswer.data) {
            txtAnswer.data.forEach((entry: Buffer) => {
              const entryStr = entry.toString();
              const [key, value] = entryStr.split('=');
              txtRecord[key] = value;
            });
          }

          const server: Server = {
            ip: serverIp,
            name: serverName,
            status: "unknown",
            lastSeen: Date.now(),
            setupComplete: txtRecord.setupComplete === 'true',
            serverName: txtRecord.serverName || serverName,
            shareName: txtRecord.shareName,
            setupTime: txtRecord.setupTime,
            serverInfo: {
              moboMake: txtRecord.moboMake,
              moboModel: txtRecord.moboModel,
              serverModel: txtRecord.serverModel,
              aliasStyle: txtRecord.aliasStyle,
              chassisSize: txtRecord.chassisSize
            }
          };

          let existingServer = discoveredServers.find((eServer) => eServer.ip === server.ip && eServer.name === server.name);

          try {
            const fetchResponse = await fetch(`http://${server.ip}:9095/setup-status`);
            if (fetchResponse.ok) {
              const setupStatusResponse = await fetchResponse.json();
              server.status = setupStatusResponse.status ?? "unknown";
            } else {
              console.warn(`HTTP error! status: ${fetchResponse.status}`);
            }

            if (!existingServer) {
              setupSsh(server);
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
            console.error('Fetch error:', error);
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

  // Periodically check for inactive servers and remove them if necessary
  const clearInactiveServerInterval = setInterval(() => {
    const currentTime = Date.now();

    // Filter out inactive servers
    const filterdDiscoveredServers = discoveredServers.filter((server) => {
      if (currentTime - server.lastSeen > TIMEOUT_DURATION) {
        console.log(`Removing inactive server: ${server}`);
        return false;
      }
      return true;
    });

    if (filterdDiscoveredServers.length !== discoveredServers.length) {
      discoveredServers = filterdDiscoveredServers;
      mainWindow.webContents.send('discovered-servers', discoveredServers);
    }

  }, 5000);

  async function pollActions(server: Server) {
    try {
      const response = await fetch(`http://${server.ip}:9095/actions?client_ip=${getLocalIP()}`);
      const data = await response.json();

      if (data.action) {
        console.log("New action received:", server, data);

        if (data.action === "mount_samba_client") {
          mountSmbPopup(data.smb_host, data.smb_share, data.smb_user, data.smb_pass, mainWindow);
        } else {
          console.log("Unknown new actions.", server);
        }
      }
    } catch (error) {
      console.error("Error polling actions:", server, error);
    }
  }

  IPCRouter.getInstance().addEventListener('mountSambaClient', async (data) => {
    const result = await mountSmbPopup(data.smb_host, data.smb_share, data.smb_user, data.smb_pass, mainWindow);

    IPCRouter.getInstance().send("renderer", "action", JSON.stringify({
      action: "mountSmbResult",
      result: result
    }))
  });

  // Poll every 5 seconds
  const pollActionInterval = setInterval(async () => {
    for (let server of discoveredServers) {
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
