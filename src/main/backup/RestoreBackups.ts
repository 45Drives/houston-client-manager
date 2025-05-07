import { getOS } from "../utils";
import fsAsync from "fs/promises";
import path from "path";
import { IPCMessageRouter } from '../../..//houston-common/houston-common-lib/lib/electronIPC';

export default async function restoreBackups(data: any, IPCRouter: IPCMessageRouter) {
  
  console.log("restore backups")

  const slash = getOS() === "win" ? "\\" : "/"

  console.log(data)
  const basePath = getOS() === "win" ? `${slash}${slash}${data.smb_host}${slash}${data.smb_share}` : `/mnt/${data.smb_share}`;
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