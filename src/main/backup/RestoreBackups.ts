import { getOS } from "../utils";
import fsAsync from "fs/promises";
import path from "path";
import { IPCMessageRouter } from "@45drives/houston-common-lib/lib/electronIPC";
import { execSync } from "child_process";

export default async function restoreBackups(
  data: any,
  IPCRouter: IPCMessageRouter
) {
  const os = getOS();

  console.debug("===  restoreBackups triggered ===");
  console.debug("Incoming restore data:", JSON.stringify(data, null, 2));

  // 1) Determine the root of the share
  let basePath: string;
  if (os === "win") {
    basePath = data.mountPoint ?? `\\\\${data.smb_host}\\${data.smb_share}`;
  } else if (os === "mac") {
    basePath = path.join("/Volumes", data.smb_share);
  } else {
    basePath = `/mnt/houston-mounts/${data.smb_share}`;
  }

  const { uuid, client } = data;
  const files = data.files as string[];

  const folderPath = path.join(basePath, uuid, client !== uuid ? client : '');
  console.debug(" Source folderPath:", folderPath);
  console.debug(" Files to restore:", files);

  // 2) Copy each file, reporting back via IPC
  for (const relFile of files) {
    const sourcePath = path.join(folderPath, relFile);
    let destPath = relFile;
    if (os === "win") {
      destPath = fixWinPath(relFile);
    }

    console.debug(` Preparing restore:`);
    console.debug(`  relFile:        ${relFile}`);
    console.debug(`  sourcePath:     ${sourcePath}`);
    console.debug(`  destPath (raw): ${destPath}`);

    try {
      await fsAsync.access(sourcePath);
      console.debug("   Source file exists");
    } catch {
      console.error(`   Source file NOT found: ${sourcePath}`);
      IPCRouter.send("renderer", "action", JSON.stringify({
        type: "restoreBackupsResult",
        result: { file: relFile, error: `Source file not found: ${sourcePath}` },
      }));
      continue;
    }

    try {
      const result = await copyFile(sourcePath, destPath, relFile);
      IPCRouter.send("renderer", "action", JSON.stringify({
        type: "restoreBackupsResult",
        result,
      }));
    } catch (err) {
      console.error(`   Copy failed:`, err);
      IPCRouter.send("renderer", "action", JSON.stringify({
        type: "restoreBackupsResult",
        result: { file: relFile, error: (err as Error).message },
      }));
    }
  }

  // 3) Tell the UI which folders were restored
  try {
    const restoredFolders = Array.from(
      new Set(files.map((f: string) => path.dirname(f)))
    ).map(f => (os === "win" ? fixWinPath(f) : f));

    console.debug(" Restored folders:", restoredFolders);

    IPCRouter.send("renderer", "action", JSON.stringify({
      type: "restoreCompleted",
      allFolders: restoredFolders,
    }));
  } catch (e) {
    console.error(" Failed to send restore completion:", e);
  }

  console.debug("===  restoreBackups finished ===");
}

async function copyFile(
  sourcePath: string,
  destRelPath: string,
  originalFilePath: string
) {
  const destFullPath = normalizeRestorePath(destRelPath);
  console.debug(` copyFile(): ${sourcePath} → ${destFullPath}`);

  const dir = path.dirname(destFullPath);

  try {
    await fsAsync.mkdir(dir, { recursive: true });
    await fsAsync.access(dir, fsAsync.constants.W_OK);
    console.debug(`   Destination dir exists and is writable: ${dir}`);
  } catch (e) {
    throw new Error(`Destination folder not writable: ${dir}`);
  }

  await fsAsync.copyFile(sourcePath, destFullPath);
  console.debug(`   File copied successfully`);
  require("child_process").execSync(`dir "${path.dirname(destFullPath)}"`);

  return { file: originalFilePath };
}


function normalizeRestorePath(relPath: string): string {
  const platform = getOS();

  if (platform === 'win') {
    // Already fixed by fixWinPath
    return relPath;
  }

  // macOS or Linux: ensure it's absolute
  if (path.isAbsolute(relPath)) {
    return relPath;
  }

  return path.resolve('/', relPath);
}


function fixWinPath(str: string): string {
  // Handle UNC-style path like: DESKTOP-123\\C\\Users\\...
  const match = str.match(/^[^\\]+\\([A-Za-z])\\(.*)/);
  if (match) {
    const drive = match[1];
    const rest = match[2].replace(/\\/g, '\\');
    return `${drive}:\\${rest}`;
  }

  // Normalize forward slashes and assume C:\ as fallback
  return path.resolve('C:\\', str.replace(/\//g, '\\'));
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