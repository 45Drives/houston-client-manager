import { getOS } from "../utils";
import fsAsync from "fs/promises";
import path from "path";
import { IPCMessageRouter } from '../../..//houston-common/houston-common-lib/lib/electronIPC';
import { execSync } from "child_process";

export default async function restoreBackups(data: any, IPCRouter: IPCMessageRouter) {
  
  console.log("restore backups")

  const slash = getOS() === "win" ? "\\" : "/"

  console.log(data)
  const basePath = getOS() === "win" ? `${slash}${slash}${data.smb_host}${slash}${data.smb_share}` : `/mnt/houston-mounts/${data.smb_share}`;
  const uuid = data.uuid;
  const client = data.client;
  let files: string[] = data.files;

  console.log("uuid", uuid)
  console.log("basePath", basePath)
  console.log("files", files)
  console.log("client", client)

  const folderPath = path.join(basePath, uuid, client);

  for (const file of files) {

    console.log("processing:", file)
    let copyToFilePath = file;
    if (getOS() === "win") {
      copyToFilePath = fixWinPath(file);
    }

    const sourcePath = folderPath + file;

    console.log("Copying " + sourcePath + " to " + copyToFilePath);


    IPCRouter.send('renderer', 'action', JSON.stringify({
      type: "restoreBackupsResult",
      result: await copyFile(sourcePath, copyToFilePath, file)
    }));
  }

  // try {
  //   const openPath = path.dirname(fixWinPath(data.files[0])); // Open first file's folder
  //   openDirectory(openPath);

  //   IPCRouter.send("renderer", "action", JSON.stringify({
  //     type: "restoreCompleted",
  //     folder: openPath
  //   }));
    
  // } catch (e) {
  //   console.error("Failed to open folder after restore:", e);
  // }
  try {
    const firstFolder = path.dirname(fixWinPath(data.files[0]));

    IPCRouter.send("renderer", "action", JSON.stringify({
      type: "restoreCompleted",
      folder: firstFolder,
      allFolders: [...new Set(data.files.map(file => path.dirname(fixWinPath(file))))]  // unique folders
    }));
  } catch (e) {
    console.error("Failed to prepare post-restore data:", e);
  }

}

async function copyFile(sourcePath: string, copyToFilePath: string, originalFilePath: string) {
  try {
    fsAsync.mkdir(path.dirname(copyToFilePath), { recursive: true });
    fsAsync.copyFile(sourcePath, copyToFilePath, 0);

    return {
      file: originalFilePath
    }
  } catch (e) {

    console.log(e);
    return {
      file: originalFilePath,
      error: "Failed to copy file"
    }

  }
}

function fixWinPath(str) {
  return str.replace(/^\\([A-Za-z])\\/, '$1:\\');
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
    console.log("Opened folder:", folderPath);
  } catch (err) {
    console.error("Failed to open folder:", err);
  }
}