import { BrowserWindow } from "electron";
import { getOS } from "../utils";
import { BackupEntry } from "@45drives/houston-common-lib";
import mountSmbPopup from "../smbMountPopup";
import path from 'path';
import fsAsync from 'fs/promises';

export default async function fetchBackupsFromServer(data: any, mainWindow: BrowserWindow): Promise<BackupEntry[]> {
  await mountSmbPopup(data.smb_host, data.smb_share, data.smb_user, data.smb_pass, mainWindow);

  const results: BackupEntry[] = [];

  const slash = getOS() === "win" ? "\\" : "/"


  // const backupRoot = getOS() === "win" ? `${slash}${slash}${data.smb_host}${slash}${data.smb_share}` : `/mnt/houston-mounts/${data.smb_share}`;
  let backupRoot: string;
  if (getOS() === "win") {
    backupRoot = `\\\\${data.smb_host}\\${data.smb_share}`;
  } else if (getOS() === "mac") {
    backupRoot = path.join("/Volumes", data.smb_share);
  } else {
    // linux
    backupRoot = `/mnt/houston-mounts/${data.smb_share}`;
  }
  
  const uuidDirs = await fsAsync.readdir(backupRoot);

  for (const uuid of uuidDirs) {
    try {
      const backupDir = path.join(backupRoot, uuid);
      const entries = await walkDir(backupDir);
      entries.sort((a, b) => a.length - b.length);

      let baseFolder = "";
      let lastModified = "Unknown";

      for (const entry of entries) {
        if (!await isDirectory(entry)) continue;

        const allFiles = await getAllFiles(entry);
        const fileCount = allFiles.filter(file => !file.isDirectory()).length;

        if (fileCount > 0) {
          // Update last modified time
          const times = await Promise.all(allFiles.map(async file => {
            const stat = await fsAsync.stat(file.parentPath);
            return stat.mtime;
          }));
          const mostRecent = new Date(Math.max(...times.map(t => t.getTime())));
          lastModified = mostRecent.toISOString().split("T")[0];

          // Compute candidate base folder
          const relPath = entry.replace(backupRoot, "").replace(slash + uuid + slash, "");

          // First match or shorter than current
          if (!baseFolder || relPath.length < baseFolder.length) {
            baseFolder = relPath;
          }
        }
      }

      // Extract client name
      const folders = baseFolder.split(slash);
      let client = "";
      if (folders.length > 0) {
        client = folders[0];
        baseFolder = baseFolder.replace(client, "").replace(/^\/+/, ""); // remove leading slash
      }

      results.push({
        uuid: uuid,
        folder: `/${baseFolder}`,  // restore leading slash for UI clarity
        server: data.smb_host,
        client: client,
        lastBackup: lastModified,
        onSystem: true,
        files: [],
      });

    } catch (err) {
      console.error("Failed to list backups:", err);
    }
  }
  

  return results;
}

async function isDirectory(path: string) {
  try {
    const stats = await fsAsync.stat(path);
    return stats.isDirectory();
  } catch (err) {
    // Optional: handle error (e.g., path doesn't exist)
    return false;
  }
}

async function walkDir(dir: string, results: string[] = []) {
  const list = await fsAsync.readdir(dir, { withFileTypes: true });

  results.push(dir);

  for (const entry of list) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(fullPath, results);
    } else {
      results.push(fullPath);
    }
  }

  return results;
}

// Helper: recursively list all files
async function getAllFiles(dir) {
  const entries = await fsAsync.readdir(dir, { withFileTypes: true });

  return entries;
}
