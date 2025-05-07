import { getOS } from "../utils";

import path from 'path';
import fs from 'fs';

export default async function fetchBackupsFromFile(data: any) {

  const slash = getOS() === "win" ? "\\" : "/"
  
  console.log(data)
  const basePath = getOS() === "win" ? `${slash}${slash}${data.smb_host}${slash}${data.smb_share}` : `/mnt/${data.smb_share}`;
  const uuid = data.uuid;

  console.log("uuid", uuid)
  console.log("basePath", basePath)

  const folderPath = path.join(basePath, uuid);

  let files: string[] = []
  try {
    files = listFiles(folderPath);
  } catch (err) {
    console.log(err);
  }

  console.log("files: ", files)

  return files;
}

// Recursively list all files
function listFiles(dir, relPath = '') {
  console.log("listfiles")
  const result: string[] = [];
  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    console.log("entry", entry)
    const fullPath = path.join(dir, entry);
    const rel = path.join(relPath, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      result.push(...listFiles(fullPath, rel));
    } else {
      result.push(rel);
    }
  }

  return result;
};
