import { BrowserWindow, dialog } from 'electron';
import os from 'os';
import installDepPopup from './installDepsPopup';
import { exec } from 'child_process';
import { getAsset } from './utils';

const options = {
  name: '45Drives Setup Wizard',
};

async function mountSambaClient(smb_host: string, smb_share: string, smb_user: string, smb_pass: string, mainWindow: BrowserWindow): Promise<string> {

  const platform = os.platform();
  console.log('platform:', platform);
  if (platform === "win32") {
    return mountSambaClientWin(smb_host, smb_share, smb_user, smb_pass, mainWindow);
  } else if (platform === "linux") {
    // console.log(`passing host:${smb_host}, share:${smb_share}, user:${smb_user}, pass:${smb_pass} to script`);
    return mountSambaClientScript(smb_host, smb_share, smb_user, smb_pass, await getAsset("static", "mount_smb_lin.sh"), mainWindow);
  } else if (platform === "darwin") {
    return mountSambaClientScript(smb_host, smb_share, smb_user, smb_pass, await getAsset("static", "mount_smb_mac.sh"), mainWindow);
  } else {
    console.log("Unknown OS:", platform);
    return "Unknown OS: " + platform;
  }

}

async function mountSambaClientWin(smb_host: string, smb_share: string, smb_user: string, smb_pass: string, mainWindow: BrowserWindow): Promise<string> {
  return new Promise((resolve, reject) => {
    getAsset("static", "mount_smb_popup.bat").then(batpath => {
      exec(`cmd /C ""${batpath}" ${smb_host} ${smb_share} ${smb_user} "${smb_pass}""`, (error, stdout, stderr) => {
        handleExecOutput(error, stdout, stderr, smb_host, smb_share, mainWindow);

        if (error) {
          reject(stderr || error.message);
        } else {
          resolve(stdout.trim());
        }
      });
    });
  });
}

function mountSambaClientScript(smb_host: string, smb_share: string, smb_user: string, smb_pass: string, script: string, mainWindow: BrowserWindow): Promise<string> {
  return new Promise((resolve, reject) => {
  //   console.log(`
  //   Mounting Details:
  //   SMB Host: ${smb_host}
  //   SMB Share: ${smb_share}
  //   SMB User: ${smb_user}
  //   SMB Password: ${smb_pass}
  // `);

    installDepPopup();

    exec(`bash "${script}" ${smb_host} ${smb_share} ${smb_user} ${smb_pass}`, (error, stdout, stderr) => {
      handleExecOutput(error, stdout, stderr, smb_host, smb_share, mainWindow);

      if (error) {
        reject(stderr || error.message);
      } else {
        resolve(stdout.trim());
      }
    });
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
    console.error(error);
    dialog.showErrorBox(error.name, error.message);
    return error;
  }
  console.log('Mount samba Output:', stdout);
  return stdout;
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

    console.log('result:', result);
    if (result.error) {
      mainWindow.webContents.send('notification', `Error: failed to connect to host=${smb_host}, share=${smb_share}.`)
    } else {
      mainWindow.webContents.send('notification', `Successfull connected to host=${smb_host}, share=${smb_share}.`);
    }
  } else {

    mainWindow.webContents.send('notification', `Error: failed to connect to host=${smb_host}, share=${smb_share}.`);
  }
  return true;
}

// Main Logic
export default function mountSmbPopup(smb_host: string, smb_share: string, smb_user: string, smb_pass: string, mainWindow: BrowserWindow): Promise<string> {
  return mountSambaClient(smb_host, smb_share, smb_user, smb_pass, mainWindow);
}