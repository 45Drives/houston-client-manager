import { BrowserWindow } from "electron";
import { getOS } from "../utils";
import { BackupEntry } from "@45drives/houston-common-lib";
import mountSmbPopup from "../smbMountPopup";
const path = require('path');
const fs = require('fs');
const fsAsync = require('fs/promises');

export default async function fetchBackupsFromServer(data: any, mainWindow: BrowserWindow): Promise<BackupEntry[]> {
  const os = getOS();
  const mountResult = await mountSmbPopup(data.smb_host, data.smb_share, data.smb_user, data.smb_pass, mainWindow);

  const mountJson = JSON.parse(mountResult);
  const results: BackupEntry[] = [];

  const slash = getOS() === "win" ? "\\" : "/"

  try {
    const backupRoot = `${slash}${slash}${data.smb_host}${slash}${data.smb_share}${slash}client-backups`;
    const uuidDirs = await fsAsync.readdir(backupRoot);

    for (const uuid of uuidDirs) {
      const backupDir = path.join(backupRoot, uuid);
      const entries = await walkDir(backupDir);
      entries.sort((a, b) => a.length - b.length);
      let baseFolder = uuid;
      let lastModified = 'Unknown';
      let keepSearchForBaseFolder = true;

      for (const entry of entries) {
        if (!await isDirectory(entry)) continue;

        console.log(entry);

        // Recursively gather files to find last modified time
        const allFiles = await getAllFiles(entry);
        const fileCount = allFiles.filter(file => !file.isDirectory()).length;
        console.log("fileCount", fileCount)
        if (allFiles.length) {
          const times = await Promise.all(allFiles.map(async file => {
            const stat = await fsAsync.stat(file.parentPath);
            return stat.mtime;
          }));
          const mostRecent = new Date(Math.max(...times.map(t => t.getTime())));
          lastModified = mostRecent.toISOString().split('T')[0]; // format YYYY-MM-DD
        }

        if (fileCount == 0 && keepSearchForBaseFolder) {
          baseFolder = entry.replace(backupRoot, "").replace(slash + uuid + slash, "");
        }
        if (fileCount > 0 && keepSearchForBaseFolder) {
          keepSearchForBaseFolder = false;
          baseFolder = entry.replace(backupRoot, "").replace(slash + uuid + slash, "");
        }
      }

      const folders = baseFolder.split(slash);
      let client = ""
      if (folders.length > 0) {
        baseFolder = baseFolder.replace(folders[0], "");
        client = folders[0];
      }

      results.push({
        uuid: uuid,
        folder: baseFolder,
        server: data.smb_host,
        client: client,
        lastBackup: lastModified,
        onSystem: true,
        files: []
      });
    }

  } catch (err) {
    console.error('Failed to list backups:', err);
  }

  return results;
}

async function isDirectory(path) {
  try {
    const stats = await fsAsync.stat(path);
    return stats.isDirectory();
  } catch (err) {
    // Optional: handle error (e.g., path doesn't exist)
    return false;
  }
}

async function walkDir(dir: String, results: String[] = []) {
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
