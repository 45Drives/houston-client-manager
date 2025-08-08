import { app, BrowserWindow } from "electron";
import { getOS, extractJsonFromOutput } from "../utils";
import { BackupEntry } from "@45drives/houston-common-lib";
import mountSmbPopup from "../smbMountPopup";
import path from 'path';
import fsAsync from 'fs/promises';

export default async function fetchBackupsFromServer(data: any, mainWindow: BrowserWindow): Promise<BackupEntry[]> {
  console.debug("[DEBUG] ▶️ fetchBackupsFromServer called with:", data);

  const baseLogDir = path.join(app.getPath('userData'), 'logs');
  const backupEventsPath = path.join(baseLogDir, '45drives_backup_events.json');

  let backupEvents: Array<{
    uuid: string;
    source: string;
    target: string;
    timestamp: string;
    status: string;
  }> = [];
  
  try {
    const raw = await fsAsync.readFile(backupEventsPath, 'utf-8');
    backupEvents = raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (e) {
    console.warn("Failed to read or parse 45drives_backup_events.json (NDJSON):", e);
  }

  // 1) mountSmbPopup returns JSON string → parse it
  const raw = await mountSmbPopup(
    data.smb_host,
    data.smb_share,
    data.smb_user,
    data.smb_pass,
    mainWindow,
    "silent"
  );

  console.debug("[DEBUG] raw mountSmbPopup output:", raw);
  
  let mountResult: { DriveLetter: string, MountPoint: string, smb_share: string };
  try {
    mountResult = extractJsonFromOutput(raw);
  } catch (e) {
    console.error("[ERROR] Failed to JSON.parse mountSmbPopup output:", e, raw);
    throw e;
  }
  console.debug("[DEBUG] parsed mountResult:", mountResult);

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
  console.debug("[DEBUG] using backupRoot:", backupRoot);

  // 3) defensively list top-level dirs
  let uuidDirs: string[];
  try {
    uuidDirs = await fsAsync.readdir(backupRoot);
    console.debug(`[DEBUG] found ${uuidDirs.length} UUID dirs:`, uuidDirs);
    uuidDirs = uuidDirs
      .filter(name => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name));
    console.debug(`[DEBUG] filtered UUID dirs:`, uuidDirs);
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

      // Find the most recent backup_end event for this uuid
      const event = backupEvents
        .filter(ev => ev.uuid === uuid && ev.status === "backup_end")
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

      let client = "";

      if (event?.source) {
        const normalized = (event.source || event.target || "").replace(/\\/g, '/');
        
        const os = getOS();

        if (os === "mac") {
          const match = normalized.match(/^\/Users\/([^/]+)/);
          if (match) client = match[1];
        } else if (os === "rocky" || os === "debian") {
          const match = normalized.match(/^\/home\/([^/]+)/);
          if (match) client = match[1];
        } else if (os === "win") {
          const match =
            normalized.match(/^C:\/Users\/([^/]+)/i) ||           // Native Windows
            normalized.match(/^\/mnt\/c\/Users\/([^/]+)/i);       // WSL-style
          if (match) client = match[1];
        }

        // Fallback if no OS-specific match worked
        if (!client) {
          const parts = normalized.split('/').filter(Boolean);
          client = parts.length > 0 ? parts[0] : "";
        }
      }

      let folder = "/";
      if (event?.source) {
        folder = event.source;
      } else if (event?.target) {
        // Remove /uuid/clientname prefix from target path
        const uuidPrefix = `/${uuid}/`;
        const normalizedTarget = event.target.replace(/\\/g, '/');
        if (normalizedTarget.includes(uuidPrefix)) {
          folder = "/" + normalizedTarget.split(uuidPrefix)[1]?.split('/').slice(1).join('/');
        }
      }

      results.push({
        uuid,
        folder: folder,
        server: data.smb_host,
        client,
        lastBackup: event?.timestamp
          ? new Date(event.timestamp).toLocaleString()
          : "Unknown",
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