import { getOS } from "../utils";
import path from "path";
import fs from "fs";

type FetchFilesFromBackupData = {
  smb_host?: string;
  smb_share: string;
  smb_user?: string;
  smb_pass?: string;
  uuid: string;
  mountPoint?: string;
  includeHidden?: boolean;
};

export default async function fetchFilesFromBackup(data: FetchFilesFromBackupData): Promise<string[]> {
  let basePath: string;

  if (getOS() === "win") {
    if (data.mountPoint) {
      basePath = data.mountPoint;
    } else {
      basePath = `\\\\${data.smb_host}\\${data.smb_share}`;
    }
  } else if (getOS() === "mac") {
    basePath = path.join("/Volumes", data.smb_share);
  } else {
    basePath = `/mnt/houston-mounts/${data.smb_share}`;
  }

  const folderPath = path.join(basePath, data.uuid);

  try {
    const files = listFiles(folderPath);

    if (data.includeHidden) return files;

    return files.filter((rel) => !isHiddenRelPath(rel));
  } catch (err) {
    console.error(`Could not list files under ${folderPath}:`, err);
    return [];
  }
}

// recursively build an array of paths _relative_ to the uuid folder
function listFiles(dir: string, relPath = ""): string[] {
  const out: string[] = [];

  // If you want to skip dot-directories early for speed, you can:
  // for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { ... }
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const nextRel = path.join(relPath, entry);
    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      out.push(...listFiles(full, nextRel));
    } else {
      out.push(nextRel);
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
