import { BrowserWindow, dialog } from 'electron';
import os from 'os';
import installDepPopup from './installDepsPopup';
import { exec } from 'child_process';
import { getAsset } from './utils';

async function mountSambaClient(smb_host: string, smb_share: string, smb_user: string, smb_pass: string, mainWindow: BrowserWindow, uiMode: "popup" | "silent" = "silent"): Promise<string> {

  const platform = os.platform();
  // console.log('platform:', platform);
  if (platform === "win32") {
    return mountSambaClientWin(smb_host, smb_share, smb_user, smb_pass, mainWindow, uiMode);
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

async function mountSambaClientWin(smb_host: string, smb_share: string, smb_user: string, smb_pass: string, mainWindow: BrowserWindow, uiMode: "popup" | "silent" = "silent"): Promise<string> {
  return new Promise((resolve, reject) => {
    getAsset("static", "mount_smb.bat").then(batpath => {
      // 1️⃣ Build + log the command
      const args = [
        smb_host,
        smb_share,
        smb_user,
        smb_pass,             // wrap in quotes below
      ];

      // only push popup if we explicitly want it
      if (uiMode === "popup") {
        args.push("popup");
      }

      // CMD wants: cmd /C ""<batPath>" arg1 arg2 "arg with spaces" argN"
      const cmd = `cmd /C ""${batpath}" ${args
        .map((a, i) => i === 3 ? `"${a}"` : a)  // only the password (index 3) gets its own quotes
        .join(" ")}"`;
      
      console.log("[DEBUG] mountSambaClientWin CMD:", cmd);

      exec(cmd, (error, stdout, stderr) => {
        // 2️⃣ Log raw outputs
        console.log("[DEBUG] mount stdout:", stdout);
        console.log("[DEBUG] mount stderr:", stderr);
        console.log("[DEBUG] mount error:", error);

        handleExecOutput(error, stdout, stderr, smb_host, smb_share, mainWindow);

        if (error) {
          // include stdout & stderr in the rejection so you can see them up in your logs
          reject({ message: error.message, stdout, stderr });
        } else {
          resolve(stdout.trim());
        }
      });
    });
  });
}

function mountSambaClientScript(smb_host: string, smb_share: string, smb_user: string, smb_pass: string, script: string, mainWindow: BrowserWindow): Promise<string> {
  return new Promise((resolve, reject) => {
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
export default function mountSmbPopup(smb_host: string, smb_share: string, smb_user: string, smb_pass: string, mainWindow: BrowserWindow, uiMode: "popup" | "silent" = "silent"): Promise<string> {
  return mountSambaClient(smb_host, smb_share, smb_user, smb_pass, mainWindow, uiMode);
}