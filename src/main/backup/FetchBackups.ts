import { BrowserWindow } from "electron";
import { getOS, extractJsonFromOutput } from "../utils";
import { BackupEntry } from "@45drives/houston-common-lib";
import mountSmbPopup from "../smbMountPopup";
import path from 'path';
import fsAsync from 'fs/promises';

export default async function fetchBackupsFromServer(data: any, mainWindow: BrowserWindow): Promise<BackupEntry[]> {
  console.log("[DEBUG] ▶️ fetchBackupsFromServer called with:", data);

  // 1) mountSmbPopup returns JSON string → parse it
  const raw = await mountSmbPopup(
    data.smb_host,
    data.smb_share,
    data.smb_user,
    data.smb_pass,
    mainWindow,
    "silent"
  );

  console.log("[DEBUG] raw mountSmbPopup output:", raw);
  
  let mountResult: { DriveLetter: string, MountPoint: string, smb_share: string };
  try {
    mountResult = extractJsonFromOutput(raw);
  } catch (e) {
    console.error("[ERROR] Failed to JSON.parse mountSmbPopup output:", e, raw);
    throw e;
  }
  console.log("[DEBUG] parsed mountResult:", mountResult);

  // 2) pick the correct root based on OS
  let backupRoot: string;
  if (getOS() === "win") {
    // use the mapped drive letter, not UNC
    backupRoot = mountResult.MountPoint;
  } else if (getOS() === "mac") {
    backupRoot = path.join("/Volumes", data.smb_share);
  } else {
    backupRoot = `/mnt/houston-mounts/${data.smb_share}`;
  }
  console.log("[DEBUG] using backupRoot:", backupRoot);

  // 3) defensively list top-level dirs
  let uuidDirs: string[];
  try {
    uuidDirs = await fsAsync.readdir(backupRoot);
    console.log(`[DEBUG] found ${uuidDirs.length} UUID dirs:`, uuidDirs);
    uuidDirs = uuidDirs
      .filter(name => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name));
    console.log(`[DEBUG] filtered UUID dirs:`, uuidDirs);
  } catch (err) {
    console.error(`Could not read backup root ${backupRoot}:`, err);
    return [];
  }

  const results: BackupEntry[] = [];
  const sep = path.sep;

  for (const uuid of uuidDirs) {
    try {
      const backupDir = path.join(backupRoot, uuid);
      const entries = await walkDir(backupDir);
      entries.sort((a, b) => a.length - b.length);

      let baseFolder = "";
      let lastModified = "Unknown";

      for (const entry of entries) {
        if (!await isDirectory(entry)) continue;

        // 4) getAllFiles now returns full paths
        const allFiles = await getAllFiles(entry);
        const fileCount = allFiles.length;
        if (fileCount === 0) continue;

        // 5) compute last-modified correctly
        const times = await Promise.all(
          allFiles.map(fp => fsAsync.stat(fp).then(st => st.mtime))
        );
        const mostRecent = new Date(Math.max(...times.map(t => t.getTime())));
        lastModified = mostRecent.toISOString().slice(0, 10);
        
        // 6) compute relative path under the share
        // let rel = entry
        //   .replace(backupRoot, "")
        //   // cut out leading slash + uuid + slash
        //   .replace(new RegExp(`^${sep}${uuid}${sep}`), "");
        const escapedSep = sep.replace(/\\/g, "\\\\");
        const uuidSepRe = new RegExp(`^${escapedSep}${uuid}${escapedSep}`);

        let rel = entry
          .replace(backupRoot, "")
          .replace(uuidSepRe, "");

        if (!baseFolder || rel.length < baseFolder.length) {
          baseFolder = rel;
        }
      }

      // 7) pull client off the front of baseFolder
      const parts = baseFolder.split(sep).filter(Boolean);
      const client = parts[0] || "";
      const rest = parts.slice(1).join(sep);

      results.push({
        uuid,
        folder: `/${rest}`,      // leading slash for UI
        server: data.smb_host,
        client,
        lastBackup: lastModified,
        onSystem: true,
        files: [],
        mountPoint: mountResult.MountPoint
      });

    } catch (err) {
      console.error("Failed to list backups for", uuid, ":", err);
    }
  }

  return results;
}

async function isDirectory(path: string) {
  try {
    return (await fsAsync.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function walkDir(dir: string, results: string[] = []) {
  // push the directory itself so we can consider empty-folder cases too
  results.push(dir);
  const list = await fsAsync.readdir(dir, { withFileTypes: true });

  for (const d of list) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) {
      await walkDir(full, results);
    } else {
      results.push(full);
    }
  }

  return results;
}

// Helper: recursively list all files (full paths)
async function getAllFiles(dir: string): Promise<string[]> {
  const list = await fsAsync.readdir(dir, { withFileTypes: true });
  const out: string[] = [];

  for (const d of list) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) {
      out.push(...await getAllFiles(full));
    } else {
      out.push(full);
    }
  }

  return out;
}