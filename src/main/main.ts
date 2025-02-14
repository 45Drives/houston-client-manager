import { app, BrowserWindow, ipcMain } from 'electron';
import path, { join } from 'path';
import mdns from 'multicast-dns';
import { powerSaveBlocker } from "electron";
import os from 'os';
import { exec } from 'child_process';
import fs from 'fs';
import asar from 'asar';
import installDepPopup from './installDepsPopup';

interface Server {
  ip: string;
  name: string;
  lastSeen: number;
  status: string | "unknown";
}

let discoveredServers: Server[] = [];

const blockerId = powerSaveBlocker.start("prevent-app-suspension");

app.commandLine.appendSwitch('ignore-certificate-errors', 'true');

app.commandLine.appendSwitch("disable-background-timer-throttling", 'true');
app.commandLine.appendSwitch("disable-renderer-backgrounding", "true");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows", 'true');

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

  mainWindow.maximize();

  mainWindow.setMenu(null);

  mainWindow.webContents.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
  );

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
    const rendererPort = process.argv[2];

    mainWindow.loadURL(`http://localhost:${rendererPort}`);
  } else {
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

        for (const answer2 of response.answers) {

          if (answer2.type === 'A') {

            const serverName = answer2.name;
            const server: Server = { ip: answer2?.data, name: serverName, status: "unknown", lastSeen: Date.now() };

            let existingServer = discoveredServers.find((eServer) => eServer.ip === server.ip && eServer.name === server.name);

            try {
              const response = await fetch(`http://${server.ip}:9095/setup-status`);
              if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
              }
              const setupStatusResponse = await response.json();

              if (!existingServer) {
                
                if (setupStatusResponse.err) {
                  server.status = "unknown";
                } else {
                  server.status = setupStatusResponse.status;
                }
                discoveredServers.push(server);
              } else {
                existingServer.lastSeen = Date.now();
                if (setupStatusResponse.err) {
                  server.status = "unknown";
                } else {
                  server.status = setupStatusResponse.status;
                }
              }

            } catch (error) {
              console.error('Fetch error:', error);
            }

           
            break server_search;
          }
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
          await mountSambaClient(server, data.smb_host, data.smb_share, data.smb_user, data.smb_pass);
        } else {
          console.log("Unknown new actions.", server);
        }
      }
    } catch (error) {
      console.error("Error polling actions:", server, error);
    }
  }

  // Poll every 5 seconds
  const pollActionInterval = setInterval(async () => {
    for (let server of discoveredServers) {
      await pollActions(server)
    }
  }, 5000);

  async function mountSambaClient(server: Server, smb_host: string, smb_share: string, smb_user: string, smb_pass: string) {

    const platform = os.platform();

    if (platform === "win32") {
      mountSambaClientWin(smb_host, smb_share, smb_user, smb_pass);
    } else if (platform === "linux") {
      mountSambaClientScript(smb_host, smb_share, smb_user, smb_pass, await getAsset("static", "mount_smb_lin.sh"));
    } else if (platform === "darwin") {
      mountSambaClientScript(smb_host, smb_share, smb_user, smb_pass, await getAsset("static", "mount_smb_mac.sh"));
    } else {
      console.log("Unknown OS:", platform);
    }

  }

  async function mountSambaClientWin(smb_host: string, smb_share: string, smb_user: string, smb_pass: string) {
    let batpath = await getAsset("static", "mount_smb.bat");

    exec(`cmd /C ""${batpath}" ${smb_host} ${smb_share} ${smb_user} "${smb_pass}""`, (error, stdout, stderr) => {
      console.log(`Stdout: ${stdout}`);
      if (error) {
        console.error(`Error: ${error.message}`);
        mainWindow.webContents.send('notification', `Error: failed to connect to \\\\${smb_host}\\${smb_share}.`);
        return;
      }
      if (stderr) {
        console.error(`Stderr: ${stderr}`);
        mainWindow.webContents.send('notification', `Error: failed to connect to \\\\${smb_host}\\${smb_share}.`);
        return;
      }

      const result = JSON.parse(stdout);
      if (result.message) {
        mainWindow.webContents.send('notification', `S${result.message}.`);
        return;
      }

      if (result.error) {
        mainWindow.webContents.send('notification', `S${result.error}.`);
        return;
      }
      mainWindow.webContents.send('notification', `Successfull connected to ${stdout}.`);
    });
  }

  async function getAsset(folder: string, fileName: string): Promise<string> {
    const filePath = path.join(__dirname, folder, fileName);

    // Check if running inside an ASAR package
    let extractedFilepath = filePath;
    if (__dirname.includes("app.asar")) {
      // Path to the .asar file (usually in the dist folder after building)
      const asarFile = path.join(__dirname).replace("\\main", "");

      // Path to extract the file to
      const tempPath = path.join(os.tmpdir(), "houston-manager", "main", folder, fileName);

      await fs.promises.mkdir(path.join(os.tmpdir(), "houston-manager", "main", folder), { recursive: true });

      // Extract the file from the asar archive
      const extractFile = (source, destination) => {
        try {
          const fileData = asar.extractFile(source, `${folder}\\${fileName}`); // Path to the file inside the .asar archive
          fs.writeFileSync(destination, fileData);
          console.log('File extracted successfully to:', destination);
        } catch (error) {
          console.error('Error extracting file:', error);
        }
      };

      // Extract `main.js` from the `app.asar` archive
      extractFile(asarFile, tempPath);

      extractedFilepath = tempPath;
    }

    return extractedFilepath;
  }

  function mountSambaClientScript(smb_host: string, smb_share: string, smb_user: string, smb_pass: string, script: string) {

    installDepPopup();

    exec(`bash ""${script}" ${smb_host} ${smb_share} ${smb_user} ${smb_pass}"`, (error, stdout, stderr) => {
      console.log(`Stdout: ${stdout}`);
      if (error) {
        console.error(`Error: ${error.message}`);
        mainWindow.webContents.send('notification', `Error: failed to connect to host=${smb_host}, share=${smb_share}.`);
        return;
      }
      if (stderr) {
        console.error(`Stderr: ${stderr}`);
        mainWindow.webContents.send('notification', `Error: failed to connect to host=${smb_host}, share=${smb_share}.`);
        return;
      }

      const result = JSON.parse(stdout);
      if (result.message) {
        mainWindow.webContents.send('notification', `S${result.message}.`);
        return;
      }

      mainWindow.webContents.send('notification', `Successfull connected to ${result}.`);
    });
  }

  ipcMain.on('message', (event, message) => {
    console.log(message);
  })

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
    console.log("webview attaching")
    webPreferences.preload = `${__dirname}/webview-preload.js`;
  });
});


app.whenReady().then(() => {
  createWindow();
  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

});
