import { getOS } from "../utils";
import path from "path";
import fs from "fs";

export type FileMetadata = {
  path: string;
  size: number;
  mtime: string;
  atime: string;
  birthtime: string;
};

type FetchFilesFromBackupData = {
  smb_host?: string;
  smb_share: string;
  smb_user?: string;
  smb_pass?: string;
  uuid: string;
  mountPoint?: string;
  includeHidden?: boolean;
};

export default async function fetchFilesFromBackup(data: FetchFilesFromBackupData): Promise<FileMetadata[]> {
  let basePath: string;

  if (getOS() === "win") {
    if (data.mountPoint) {
      basePath = data.mountPoint;
    } else {
      basePath = `\\\\${data.smb_host}\\${data.smb_share}`;
    }
  } else if (getOS() === "mac") {
    if (data.mountPoint) {
      basePath = data.mountPoint;
    } else {
      basePath = path.join("/Volumes", data.smb_share);
    }
  } else {
    if (data.mountPoint) {
      basePath = data.mountPoint;
    } else {
      basePath = `/mnt/houston-mounts/${data.smb_share}`;
    }
  }

  const folderPath = path.join(basePath, data.uuid);

  try {
    const files = listFiles(folderPath);

    if (data.includeHidden) return files;

    return files.filter((f) => !isHiddenRelPath(f.path));
  } catch (err) {
    console.error(`Could not list files under ${folderPath}:`, err);
    return [];
  }
}

// recursively build an array of file metadata objects _relative_ to the uuid folder
function listFiles(dir: string, relPath = ""): FileMetadata[] {
  const out: FileMetadata[] = [];

  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const nextRel = path.join(relPath, entry);
    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      out.push(...listFiles(full, nextRel));
    } else {
      out.push({
        path: nextRel,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        atime: stat.atime.toISOString(),
        birthtime: stat.birthtime.toISOString(),
      });
    }
  }

  return out;
}

function isHiddenRelPath(relPath: string): boolean {
  // normalize separators
  const parts = relPath.split(/[\\/]+/).filter(Boolean);

  // hide anything inside dot-directories: ".git/config", ".Trash/file", etc.
  if (parts.some((p) => p.startsWith("."))) return true;

  const base = parts[parts.length - 1] ?? "";

  // common macOS / SMB noise
  if (base === ".DS_Store") return true;
  if (base === ".localized") return true;

  // AppleDouble resource fork files produced on SMB/AFP copies
  if (base.startsWith("._")) return true;

  return false;
}
