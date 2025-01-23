import { app, BrowserWindow, ipcMain, session } from 'electron';
import { join } from 'path';
import mdns from 'multicast-dns';
import { powerSaveBlocker } from "electron";

const blockerId = powerSaveBlocker.start("prevent-app-suspension");

app.commandLine.appendSwitch('ignore-certificate-errors', 'true');

app.commandLine.appendSwitch("disable-background-timer-throttling", 'true');
app.commandLine.appendSwitch("disable-renderer-backgrounding", "true");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows", 'true');

// Timeout duration in milliseconds (e.g., 30 seconds)
const TIMEOUT_DURATION = 10000;
const serviceType = '_houstonserver._tcp.local'; // Define the service you're looking for

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
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

  // mainWindow.setMenu(null);

  mainWindow.webContents.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
  );

  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
    const rendererPort = process.argv[2];

    mainWindow.loadURL(`http://localhost:${rendererPort}`);
  }
  else {
    mainWindow.loadFile(join(app.getAppPath(), 'renderer', 'index.html'));
  }


  // Set up mDNS for service discovery
  const mDNSClient = mdns(); // Correctly call as a function

  let discoveredServers: { ip: string; name: string; lastSeen: number }[] = [];

  // Start listening for devices
  mDNSClient.on('response', (response) => {

    server_search:
    for (const answer1 of response.answers) {
      if (answer1.type === 'SRV' && answer1.name.includes(serviceType)) {

        for (const answer2 of response.answers) {

          if (answer2.type === 'A') {

            const serverName = answer2.name;
            const server = { ip: answer2?.data, name: serverName, lastSeen: Date.now() };

            let existingServer = discoveredServers.find((eServer) => eServer.ip === server.ip && eServer.name === server.name);

            if (!existingServer) {

              discoveredServers.push(server);
            } else {
              existingServer.lastSeen = Date.now();
            }
            break server_search;
          }
        }
      }
    }

    if (mainWindow) {
      mainWindow.webContents.send('discovered-servers', discoveredServers);
    }
  });

  setInterval(() => {
    mDNSClient.query({
      questions: [{ name: '_houstonserver._tcp.local', type: 'PTR' }],
    })
  }, 5000);

  // Periodically check for inactive servers and remove them if necessary
  setInterval(() => {
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
}

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

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
});

ipcMain.on('message', (event, message) => {
  console.log(message);
})