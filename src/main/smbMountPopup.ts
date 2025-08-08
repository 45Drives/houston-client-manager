import { BrowserWindow, dialog } from 'electron';
import os from 'os';
import installDepPopup from './installDepsPopup';
import { exec } from 'child_process';
import { getAsset, extractJsonFromOutput } from './utils';

async function mountSambaClient(smb_host: string, smb_share: string, smb_user: string, smb_pass: string, mainWindow: BrowserWindow, uiMode: "popup" | "silent" = "silent"): Promise<string> {

  const platform = os.platform();
  if (platform === "win32") {
    return mountSambaClientWin(smb_host, smb_share, smb_user, smb_pass, mainWindow, uiMode);
  } else if (platform === "linux") {
    // console.debug(`passing host:${smb_host}, share:${smb_share}, user:${smb_user}, pass:${smb_pass} to script`);
    return mountSambaClientScriptLin(smb_host, smb_share, smb_user, smb_pass, await getAsset("static", "mount_smb_lin.sh"), mainWindow);
  } else if (platform === "darwin") {
    console.debug("mounting smb mac")
    return mountSambaClientScriptMac(smb_host, smb_share, smb_user, await getAsset("static", "mount_smb_mac.sh"), mainWindow, uiMode);
  } else {
    console.debug("Unknown OS:", platform);
    return "Unknown OS: " + platform;
  }

}

function quoteShellSafe(str: string): string {
  return `"${str.replace(/(["^&|<>])/g, '^$1')}"`;
}

async function mountSambaClientWin(
  smb_host: string,
  smb_share: string,
  smb_user: string, // Still passed, but not needed anymore
  smb_pass: string, // Still passed, but not needed anymore
  mainWindow: BrowserWindow,
  uiMode: "popup" | "silent" = "silent"
): Promise<string> {
  return new Promise((resolve, reject) => {
    getAsset("static", "mount_smb.bat").then(batpath => {
      // 1️⃣ Path to .cred file
      const credFile = `C:\\ProgramData\\houston-backups\\credentials\\${smb_share}.cred`;
      console.debug("[DEBUG - mountSMBWin] script path being used:", batpath);
      // 2️⃣ Construct argument list
      const args = [
        quoteShellSafe(smb_host),
        quoteShellSafe(smb_share),
        quoteShellSafe(credFile),
      ];

      if (uiMode === "popup") {
        args.push("popup");
      }

      // 3️⃣ Full command
      const cmd = `cmd /C "${quoteShellSafe(batpath)} ${args.join(" ")}"`;
      console.debug("[DEBUG] mountSambaClientWin CMD:", cmd);

      exec(cmd, (error, stdout, stderr) => {
        console.debug("[DEBUG] mount stdout:", stdout);
        console.debug("[DEBUG] mount stderr:", stderr);
        console.debug("[DEBUG] mount error:", error);

        handleExecOutput(error, stdout, stderr, smb_host, smb_share, mainWindow);

        if (error) {
          reject({ message: error.message, stdout, stderr });
        } else {
          resolve(stdout.trim());
        }
      });
    });
  });
}


function mountSambaClientScriptLin(smb_host: string, smb_share: string, smb_user: string, smb_pass: string, script: string, mainWindow: BrowserWindow): Promise<string> {
  return new Promise((resolve, reject) => {
    // installDepPopup();
    console.debug("[DEBUG - mountSMBLin] script path being used:", script);
    exec(`bash "${script}" "${smb_host}" "${smb_share}" "${smb_user}" "${smb_pass}"`, (error, stdout, stderr) => {
      handleExecOutput(error, stdout, stderr, smb_host, smb_share, mainWindow);

      if (error) {
        reject(stderr || error.message);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function mountSambaClientScriptMac(
  smb_host: string,
  smb_share: string,
  smb_user: string,
  script: string,
  mainWindow: BrowserWindow,
  uiMode: "popup" | "silent" = "silent"): Promise<string> {

  return new Promise((resolve, reject) => {
    // installDepPopup();
    console.debug("[DEBUG - mountSMBMac] script path being used:", script);
    exec(`bash "${script}" "${smb_host}" "${smb_share}" "${smb_user}" "${uiMode}"`, (error, stdout, stderr) => {
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
  mainWindow: BrowserWindow
) {
  console.debug(`Stdout: ${stdout}`);
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
    const result = extractJsonFromOutput(stdout.toString());

    if (result.message) {
      mainWindow.webContents.send('notification', `S${result.message}.`);
      return false;
    }

    console.debug('result:', result);
    if (result.error) {
      mainWindow.webContents.send('notification', `Error: failed to connect to host=${smb_host}, share=${smb_share}.`)
    } else {
      mainWindow.webContents.send('notification', `Successfully connected to host=${smb_host}, share=${smb_share}.`);
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