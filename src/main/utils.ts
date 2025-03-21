import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import asar from 'asar';

export function getOS(): 'mac' | 'rocky' | 'debian' | 'win' {
  const platform = os.platform();
  if (platform === 'darwin') return 'mac';
  try {
    const releaseInfo = execSync('cat /etc/os-release', { encoding: 'utf-8' }).toLowerCase();
    if (releaseInfo.toLocaleLowerCase().includes('rocky')) return 'rocky';
    if (releaseInfo.includes('debian') || releaseInfo.includes('ubuntu')) return 'debian';
  } catch (error) {
  }
  return "win";
}


export async function getAsset(folder: string, fileName: string, isFolder: boolean = false): Promise<string> {
  const filePath = path.join(__dirname, "..", "..", folder, fileName);

  console.log("asset: ", filePath);

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
        if (isFolder) {
          const fileData = asar.extractAll(source, `${destination}\\${fileName}`); // Path to the file inside the .asar archive
          console.log('File extracted successfully to:', `${destination}\\${fileName}`);
        } else {

          const fileData = asar.extractFile(source, `${folder}\\${fileName}`); // Path to the file inside the .asar archive
          fs.writeFileSync(destination, fileData);
          console.log('File extracted successfully to:', destination);
        }
      } catch (error) {
        console.error('Error extracting file:', error);
      }
    };

    // Extract `main.js` from the `app.asar` archive
    if (!fs.existsSync(tempPath)) {

      extractFile(asarFile, tempPath);
    }

    extractedFilepath = tempPath;
  }

  return extractedFilepath;
}

export function getAppPath() {
  // Determine the base path
  const isDev = process.env.NODE_ENV === 'development';
  let basePath = process.resourcesPath || __dirname;
  if (isDev) {
    basePath = __dirname + "/../../static/"
  }
  return basePath;
}

export function getSSHTargetFromSmbTarget(target: string) {
  return target.replace(":", ":/tank/");
}

export function getSmbTargetFromSSHTarget(target: string) {
  return target.replace(":/tank/", ":");
}

export function getRsync() {
  let basePath = getAppPath();

  const sshKeyPath = path.join(basePath, ".ssh", "id_rsa");
  const rsyncPath = getOS() === "win" ? path.join(basePath, "cwrsync", "bin", "rsync.exe") : "rsync";
  const sshWithKey = `ssh -i '${sshKeyPath}'`;
  const rsync = `${rsyncPath} -az -e "${sshWithKey}"`
  return rsync;
}


export function getScp() {
  let basePath = getAppPath();

  const sshKeyPath = path.join(basePath, ".ssh", "id_rsa");
  const scpPath = getOS() === "win" ? "scp" : "scp";
  const scp = `${scpPath} -i ""${sshKeyPath}"" -r`
  return scp;
}

export function getNoneQuotedScp() {
  let basePath = getAppPath();

  const sshKeyPath = path.join(basePath, ".ssh", "id_rsa");
  const scpPath = getOS() === "win" ? "scp" : "scp";
  const scp = `${scpPath} -i "${sshKeyPath}" -r`
  return scp;
}
export function formatDateForTask(date) {
  const pad = (n) => String(n).padStart(2, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());

  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}