import { app, BrowserWindow, ipcMain, session } from 'electron';
import { join } from 'path';
import mdns from 'multicast-dns';

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  if (process.env.NODE_ENV === 'development') {
    const rendererPort = process.argv[2];
    mainWindow.loadURL(`http://localhost:${rendererPort}`);
  }
  else {
    mainWindow.loadFile(join(app.getAppPath(), 'renderer', 'index.html'));
  }


  // Set up mDNS for service discovery
  const mDNSClient = mdns(); // Correctly call as a function

  const serviceType = '_houstonserver._tcp.local'; // Define the service you're looking for
  const servers: { ip: string; name: string }[] = [];

  // Start listening for devices
  mDNSClient.on('response', (response) => {

    console.log(response);

    server_search:
    for (const answer1 of response.answers) {
      if (answer1.type === 'SRV' && answer1.name.includes(serviceType)) {

        for (const answer2 of response.answers) {

          if (answer2.type === 'A') {
            const serverName = answer2.name;
            const server = { ip: answer2?.data, name: serverName };

            if (!servers.find((eServer) => eServer.ip === server.ip && eServer.name === server.name)) {

              servers.push(server);
            } 
            break server_search;
          }

        }
      }
    }
   

    if (mainWindow) {
      mainWindow.webContents.send('discovered-servers', servers);
    }
  });

  // Query the network for services
  mDNSClient.query({
    questions: [{ name: '_houstonserver._tcp.local', type: 'PTR' }],
  });
}

app.whenReady().then(() => {
  createWindow();

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ['script-src \'self\'']
      }
    })
  })

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