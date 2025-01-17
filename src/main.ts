import * as path from 'path';
import mdns from 'multicast-dns'; // Correctly import as default export
import { app, BrowserWindow } from 'electron';

// Create the main window (Electron)
let mainWindow: Electron.BrowserWindow | null = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
        },
    });

    mainWindow.loadURL('http://localhost:8080'); // Or load your Vue app
}

// Set up mDNS for service discovery
const mDNSClient = mdns(); // Correctly call as a function

const serviceType = '_http._tcp.local'; // Define the service you're looking for

// Start listening for devices
mDNSClient.on('response', (response: any) => {
    console.log('Discovered service:', response);
    const services = response.answers.filter((answer: any) => answer.type === 'A');
    const servers = services.map((service: any) => ({
        ip: service.data,
        name: response.name,
    }));

    if (mainWindow) {
        mainWindow.webContents.send('discovered-servers', servers);
    }
});

// Query the network for services
mDNSClient.query({
    questions: [{ name: serviceType, type: 'PTR' }],
});

// Create window when Electron is ready
app.whenReady().then(createWindow);

// Quit when all windows are closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
