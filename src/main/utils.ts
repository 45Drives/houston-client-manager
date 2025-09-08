import os from 'os';
import path from 'path';
import fs from 'fs';

export function getOS(): 'mac' | 'rocky' | 'debian' | 'win' {
  const platform = os.platform();
  if (platform === 'darwin') return 'mac';

  try {
    const releaseInfo = fs.readFileSync('/etc/os-release', 'utf-8').toLowerCase();
    if (releaseInfo.includes('rocky')) return 'rocky';
    if (releaseInfo.includes('debian') || releaseInfo.includes('ubuntu')) return 'debian';
  } catch (error) { }

  return 'win';
}

export function getRsync() {
  let basePath = getAppPath();

  const sshKeyPath = path.join(basePath, ".ssh", "id_rsa");
  const rsyncPath = getOS() === "win" ? path.join(basePath, "cwrsync", "bin", "rsync.exe") : "rsync";
  const sshWithKey = `ssh -i '${sshKeyPath}'`;
  const rsync = `${rsyncPath} -az -e "${sshWithKey}"`
  return rsync;
}


export async function getAsset(folder: string, fileName: string, isFolder: boolean = false): Promise<string> {
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {

    const os = getOS();
    if (os === "mac") {
      const filePath = path.join(__dirname, "..", "..", "..", "..", "src", "main", folder, fileName);

      console.debug("asset: ", filePath);

      return filePath;
    } else {
      const filePath = path.join(__dirname, "..", "..", folder, fileName);

      console.debug("asset: ", filePath);

      return filePath;
    }
    
  } else {

    const filePath = path.join(__dirname, "..", "..", "..", folder, fileName);

    console.debug("asset: ", filePath);

    return filePath;
  }  
}

export function extractJsonFromOutput(output: string): any {
  try {
    // Try to find the first valid-looking JSON object in the string
    const jsonMatch = output.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      // console.warn('[extractJsonFromOutput] No JSON object found in output:', output);
      return { error: true, message: 'No JSON object found in output' };
    }

    const jsonString = jsonMatch[0];
    return JSON.parse(jsonString);
  } catch (err) {
    // console.error('[extractJsonFromOutput] Failed to parse JSON:', err);
    return { error: true, message: 'Invalid JSON format in output' };
  }
}


export function getAppPath() {
  // Determine the base path
  const isDev = process.env.NODE_ENV === 'development';
  let basePath = process.resourcesPath || __dirname;
  if (isDev) {
    if (getOS() == "win") {

      basePath = __dirname + "\\..\\..\\static\\"
    } else {

      basePath = __dirname + "/../../static/"
    }
  }

  console.debug("[getAppPath] resolved to:", basePath); // <--- ADD THIS

  return basePath;
}

export function getMountSmbScript() {
  if (getOS() === "win") {
    if (isDev()) {

      return path.join(getAppPath(), "mount_smb.bat");
    } else {

      return path.join(getAppPath(), "static", "mount_smb.bat");
    }
  } else if (getOS() === "mac") {
    return path.join(getAppPath(), "mount_smb_mac.sh");
  } else {
    return path.join(getAppPath(), "mount_smb_lin.sh")
  }
}

export function isDev() {
  return process.env.NODE_ENV === 'development';
}

export function getSmbTargetFromSmbTarget(target: string) {
  // console.debug('[getSmbTargetFromSmbTarget] raw target:', target);
  // let targetPath = "/tank/" + target.split(":")[1];
  // console.debug("[getSmbTargetFromSmbTarget] targetPath", targetPath)
  let [smbHost, smbShare] = target.split(":");
  // console.debug("[getSmbTargetFromSmbTarget] smbHost", smbHost)
  // console.debug("[getSmbTargetFromSmbTarget] smbShare before", smbShare)
  smbShare = smbShare.split("/")[0]; 
  // console.debug("[getSmbTargetFromSmbTarget] smbShare after", smbShare)
  const result = target.replace(smbHost + ":" + smbShare, "");
  // console.debug("[getSmbTargetFromSmbTarget] result", result)
  return result;
}

export function getSSHTargetFromSmbTarget(target: string) {
  return target.replace(":", ":'\"\"/tank/") + "\"\"'";
}

export function getSmbTargetFromSSHTarget(target: string) {
  return target.replace(":/tank/", ":");
}

export function reconstructFullTarget(scriptPath: string): string {
  try {
    const content = fs.readFileSync(scriptPath, 'utf-8');

    const hostMatch = content.match(/SMB_HOST=['"]([^'"]+)['"]/);
    const shareMatch = content.match(/SMB_SHARE=['"]([^'"]+)['"]/);
    const targetMatch = content.match(/TARGET=['"]([^'"]+)['"]/);

    if (!hostMatch || !shareMatch || !targetMatch) {
      console.warn(" Missing SMB_HOST, SMB_SHARE, or TARGET in script:", scriptPath);
      return '';
    }

    const smbHost = hostMatch[1];
    const smbShare = shareMatch[1];
    const targetPath = targetMatch[1].replace(/^\/+/, ''); // Remove leading slashes

    return `${smbHost}:${smbShare}/${targetPath}`;
  } catch (err) {
    console.error(" Failed to read or parse script:", err);
    return '';
  }
}

export function getScp() {
  const sshKeyPath = getSSHKey();
  const scpPath = "scp";
  const scp = `${scpPath} -o StrictHostKeyChecking=no -o PasswordAuthentication=no -i ""${sshKeyPath}"" -r`
  return scp;
}

export function getSsh() {
  const sshKeyPath = getSSHKey();
  return `ssh -o StrictHostKeyChecking=no -o PasswordAuthentication=no -i ""${sshKeyPath}""`;
}

export function getSSHKey() {
  let basePath = getAppPath();

  const sshKeyPath = path.join(basePath, ".ssh", "id_rsa");
  return sshKeyPath;
}

export function getNoneQuotedScp() {
  const sshKeyPath = getSSHKey();
  const scpPath = "scp";
  const scp = `${scpPath} -o StrictHostKeyChecking=no -o PasswordAuthentication=no -i "${sshKeyPath}" -r`
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

export function formatDateForTask2(date) {
  const pad = (n) => String(n).padStart(2, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());

  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}