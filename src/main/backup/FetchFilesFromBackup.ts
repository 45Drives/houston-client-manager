import { getOS } from "../utils";
import path from "path";
import fs from "fs";

export default async function fetchFilesFromBackup(data: any): Promise<string[]> {
  let basePath: string;

  if (getOS() === "win") {
    // 1) if you’ve passed the mountPoint along, use that
    if (data.mountPoint) {
      basePath = data.mountPoint;
    } else {
      // 2) otherwise fall back (but ideally you’ll always have mountPoint)
      basePath = `\\\\${data.smb_host}\\${data.smb_share}`;
    }
  } else if (getOS() === "mac") {
    basePath = path.join("/Volumes", data.smb_share);
  } else {
    basePath = `/mnt/houston-mounts/${data.smb_share}`;
  }

  const uuid = data.uuid;
  const folderPath = path.join(basePath, uuid);

  try {
    return listFiles(folderPath);
  } catch (err) {
    console.error(`Could not list files under ${folderPath}:`, err);
    return [];
  }
}

// recursively build an array of paths _relative_ to the uuid folder
function listFiles(dir: string, relPath = ""): string[] {
  const out: string[] = [];
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
