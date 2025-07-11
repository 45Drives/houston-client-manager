import { getOS } from "../utils";
import fsAsync from "fs/promises";
import path from "path";
import { IPCMessageRouter } from "@45drives/houston-common-lib/lib/electronIPC";
import { execSync } from "child_process";

export default async function restoreBackups(
  data: any,
  IPCRouter: IPCMessageRouter
) {
  // 1) Determine the root of the share
  let basePath: string;
  if (getOS() === "win") {
    basePath = data.mountPoint ?? `\\\\${data.smb_host}\\${data.smb_share}`;
  } else if (getOS() === "mac") {
    basePath = path.join("/Volumes", data.smb_share);
  } else {
    basePath = `/mnt/houston-mounts/${data.smb_share}`;
  }

  const { uuid, client } = data;
  const files = data.files as string[];  
  const folderPath = path.join(basePath, uuid, client);

  // 2) Copy each file, reporting back via IPC
  for (const relFile of files as string[]) {
    const sourcePath = path.join(folderPath, relFile);
    let destPath = relFile;
    if (getOS() === "win") {
      destPath = fixWinPath(relFile);
    }
    try {
      const result = await copyFile(sourcePath, destPath, relFile);
      IPCRouter.send(
        "renderer",
        "action",
        JSON.stringify({
          type: "restoreBackupsResult",
          result,
        })
      );
    } catch (err) {
      IPCRouter.send(
        "renderer",
        "action",
        JSON.stringify({
          type: "restoreBackupsResult",
          result: { file: relFile, error: (err as Error).message },
        })
      );
    }
  }

  // 3) Once done, tell the UI which folders were restored
  try {
    const restoredFolders = Array.from(
      new Set(files.map((f: string) => path.dirname(f)))
    ).map(f => (getOS() === "win" ? fixWinPath(f) : f));

    IPCRouter.send(
      "renderer",
      "action",
      JSON.stringify({
        type: "restoreCompleted",
        allFolders: restoredFolders,
      })
    );
  } catch (e) {
    console.error("Failed to send restore completion:", e);
  }
}

async function copyFile(
  sourcePath: string,
  destRelPath: string,
  originalFilePath: string
) {
  const destFullPath = path.resolve(destRelPath);
  await fsAsync.mkdir(path.dirname(destFullPath), { recursive: true });
  await fsAsync.copyFile(sourcePath, destFullPath);
  return { file: originalFilePath };
}

function fixWinPath(str: string) {
  // turn "\folder\file.txt" into "C:\folder\file.txt" if needed
  return str.replace(/^\\([A-Za-z])\\/, "$1:\\");
}

function openDirectory(folderPath: string) {
  try {
    const platform = getOS();
    if (platform === "win") {
      execSync(`start "" "${folderPath}"`);
    } else if (platform === "mac") {
      execSync(`open "${folderPath}"`);
    } else {
      execSync(`xdg-open "${folderPath}"`);
    }
  } catch (err) {
    console.error("Failed to open folder:", err);
  }
}