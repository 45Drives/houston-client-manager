import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import asar from 'asar';
import { writeFileSync } from "fs";
import { join } from "path";

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
    const filePath = path.join(__dirname, "..", "..", folder, fileName);

    console.log("asset: ", filePath);

    return filePath;
  } else {

    const filePath = path.join(__dirname, "..", "..", "..", folder, fileName);

    console.log("asset: ", filePath);

    return filePath;
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
  return basePath;
}

export function getMountSmbScript() {
  if (getOS() === "win") {
    return path.join(getAppPath(), "mount_smb.bat");
  } else if (getOS() === "mac") {
    return path.join(getAppPath(), "mount_smb_mac.sh");
  } else {
    return path.join(getAppPath(), "mount_smb_lin.sh")
  }
}

export function getSmbTargetFromSmbTarget(target: string) {
  // console.log('[getSmbTargetFromSmbTarget] raw target:', target);
  let targetPath = "/tank/" + target.split(":")[1];
  // console.log("[getSmbTargetFromSmbTarget] targetPath", targetPath)
  let [smbHost, smbShare] = target.split(":");
  // console.log("[getSmbTargetFromSmbTarget] smbHost", smbHost)
  // console.log("[getSmbTargetFromSmbTarget] smbShare before", smbShare)
  smbShare = smbShare.split("/")[0]; 
  // console.log("[getSmbTargetFromSmbTarget] smbShare after", smbShare)
  const result = target.replace(smbHost + ":" + smbShare, "");
  // console.log("[getSmbTargetFromSmbTarget] result", result)
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
      console.warn("❌ Missing SMB_HOST, SMB_SHARE, or TARGET in script:", scriptPath);
      return '';
    }

    const smbHost = hostMatch[1];
    const smbShare = shareMatch[1];
    const targetPath = targetMatch[1].replace(/^\/+/, ''); // Remove leading slashes

    return `${smbHost}:${smbShare}/${targetPath}`;
  } catch (err) {
    console.error("❌ Failed to read or parse script:", err);
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


/**
 * Append a line to a root-owned file using a privileged script.
 * If the file doesn't exist, it will be created with correct permissions.
 */
export function runPrivilegedAppend(line: string, targetFile: string, pkexec = "pkexec") {
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const scriptPath = join(tmpDir, `append_cron_line_${timestamp}.sh`);

  const escapedLine = line.replace(/'/g, "'\\''");

  const scriptContent = `#!/bin/bash
set -e

# Create file if missing and set ownership/permissions
if [ ! -f '${targetFile}' ]; then
  touch '${targetFile}'
  chmod 644 '${targetFile}'
  chown root:root '${targetFile}'
fi

# Append the line
echo '${escapedLine}' >> '${targetFile}'

# Ensure permissions are enforced again just in case
chmod 644 '${targetFile}'
chown root:root '${targetFile}'
`;

  writeFileSync(scriptPath, scriptContent, { mode: 0o700 });

  execSync(`${pkexec} bash "${scriptPath}"`);
}


/**
 * Atomically replace a root-owned system file with new content and optionally delete extra files.
 *
 * @param newContent - New content to write into the target file.
 * @param targetPath - Absolute path to the file to replace (e.g. /etc/cron.d/houston-backup-manager).
 * @param pkexecCmd - Privilege escalation command (defaults to 'pkexec').
 * @param options.deleteFiles - Array of additional file paths to delete (e.g. old scripts).
 */
export function runPrivilegedReplaceFile(
  newContent: string,
  targetPath: string,
  pkexecCmd: string = 'pkexec',
  options: { deleteFiles?: string[] } = {}
): void {
  // Create a temporary working directory
  const tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'priv-replace-'));
  const tmpFile = join(tmpDir, 'new_file');
  const scriptFile = join(tmpDir, 'replace.sh');

  // Write the new content to a temp file
  fs.writeFileSync(tmpFile, newContent, { encoding: 'utf-8' });

  // Prepare the shell script for privileged operations
  const restartService = getOS() === 'debian' ? 'cron' : 'crond';
  let script = `#!/bin/bash
mv "${tmpFile}" "${targetPath}"
chown root:root "${targetPath}"
chmod 644 "${targetPath}"
`;

  // Optionally delete any extra files (e.g. orphaned scripts)
  (options.deleteFiles || []).forEach(path => {
    script += `rm -f "${path}"
`;
  });

  // Restart cron service
  script += `systemctl restart ${restartService}
`;

  // Write and execute the helper script under root
  fs.writeFileSync(scriptFile, script, { mode: 0o700 });
  execSync(`${pkexecCmd} bash "${scriptFile}"`, { stdio: 'inherit' });
}