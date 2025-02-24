import { BrowserWindow, dialog } from 'electron';
import sudo from 'sudo-prompt';
import os from 'os';
import installDepPopup from './installDepsPopup';
import path from 'path';
import fs from 'fs';
import asar from 'asar';
import { Server } from './types';
import { exec } from 'child_process';

const options = {
  name: 'Houston Client Manager',
};

async function mountSambaClient(server: Server, smb_host: string, smb_share: string, smb_user: string, smb_pass: string, mainWindow: BrowserWindow) {

  const platform = os.platform();
  console.log('platform:', platform);
  if (platform === "win32") {
    mountSambaClientWin(smb_host, smb_share, smb_user, smb_pass, mainWindow);
  } else if (platform === "linux") {
    mountSambaClientScript(smb_host, smb_share, smb_user, smb_pass, await getAsset("static", "mount_smb_lin.sh"), mainWindow);
  } else if (platform === "darwin") {
    mountSambaClientScript(smb_host, smb_share, smb_user, smb_pass, await getAsset("static", "mount_smb_mac.sh"), mainWindow);
  } else {
    console.log("Unknown OS:", platform);
  }

}

async function mountSambaClientWin(smb_host: string, smb_share: string, smb_user: string, smb_pass: string, mainWindow: BrowserWindow) {
  let batpath = await getAsset("static", "mount_smb.bat");
  let addtasksPath = await getAsset("static", "windows_add_mount_smbd_task.ps1");

  exec(`cmd /C ""${batpath}" ${smb_host} ${smb_share} ${smb_user} "${smb_pass}""`, (error, stdout, stderr) => {
    handleExecOutput(error, stdout, stderr, smb_host, smb_share, mainWindow);

    // If all works out try adding a schedualed task as admin 
    if (!error && !stderr && stdout) {

      const result = JSON.parse(stdout.toString());
      if (!result.message) {

        sudo.exec(`powershell -ExecutionPolicy Bypass -File "${addtasksPath}" \\\\${smb_host}\\${smb_share} ${smb_user} "${smb_pass}"`, options, (error, stdout, stderr) => {
          if (error) {
            console.error( error);
            dialog.showErrorBox(error.name, error.message);
            return;
          }
        });
      }

    }
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

function mountSambaClientScript(smb_host: string, smb_share: string, smb_user: string, smb_pass: string, script: string, mainWindow: BrowserWindow) {

  installDepPopup();

  sudo.exec(`bash "${script}" ${smb_host} ${smb_share} ${smb_user} ${smb_pass}`, options, (error, stdout, stderr) => {
    handleExecOutput(error, stdout, stderr, smb_host, smb_share, mainWindow);
  });
}

function handleExecOutput(
  error: Error | undefined | null,
  stdout: string | any | undefined,
  stderr: string | any | undefined,
  smb_host: string,
  smb_share: string,
  mainWindow: BrowserWindow) {

  handleExecOutputWithOutPopup(error, stdout, stderr, smb_host, smb_share, mainWindow);

  if (error) {
    console.error( error);
    dialog.showErrorBox(error.name, error.message);
    return;
  }
  console.log('Mount samba Output:', stdout);
  dialog.showMessageBox({
    type: 'info',
    title: 'Connection To Storage',
    message: 'Connected!',
  });
}

function handleExecOutputWithOutPopup(
  error: Error | undefined | null,
  stdout: string | any | undefined,
  stderr: string | any | undefined,
  smb_host: string,
  smb_share: string,
  mainWindow: BrowserWindow
) {
  console.log(`Stdout: ${stdout}`);
  if (error) {
    console.error(`Error: ${error.message}`);
    mainWindow.webContents.send('notification', `Error: failed to connect to host=${smb_host}, share=${smb_share}.`);
    return false;
  }
  if (stderr) {
    console.error(`Stderr: ${stderr}`);
    mainWindow.webContents.send('notification', `Error: failed to connect to host=${smb_host}, share=${smb_share}.`);
    return false;
  }

  if (stdout) {

    const result = JSON.parse(stdout.toString());
    if (result.message) {
      mainWindow.webContents.send('notification', `S${result.message}.`);
      return false;
    }

    mainWindow.webContents.send('notification', `Successfull connected to ${result}.`);
  } else {

    mainWindow.webContents.send('notification', `Error: failed to connect to host=${smb_host}, share=${smb_share}.`);
  }
  return true;
}

// Main Logic
export default function mountSmbPopup(server: Server, smb_host: string, smb_share: string, smb_user: string, smb_pass: string, mainWindow: BrowserWindow) {

  dialog
    .showMessageBox({
      type: 'info',
      title: 'Creating Connection To Storage',
      message: `Trying to setup connection to storage server:\n\n
    host=${smb_host}\n
    \n\nYou will need to enter your administrator password to install them.`,
      buttons: ['OK', 'Cancel'],
    })
    .then((result) => {
      if (result.response === 0) {
        mountSambaClient(server, smb_host, smb_share, smb_user, smb_pass, mainWindow);
      }
    });

}