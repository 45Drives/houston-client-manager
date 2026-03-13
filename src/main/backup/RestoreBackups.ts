import { getOS } from "../utils";
import fsAsync from "fs/promises";
import fs from "fs";
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

  // const { uuid, client } = data;
  const { uuid } = data;  
  const files = data.files as string[];

  // const folderPath = path.join(basePath, uuid, client !== uuid ? client : '');
  const folderPath = path.join(basePath, uuid);
  console.debug(" Source folderPath:", folderPath);
  console.debug(" Files to restore:", files);

  // 2) Copy each file, reporting back via IPC
  for (let i = 0; i < files.length; i++) {
    const relFile = files[i];
    const sourcePath = path.join(folderPath, relFile);
    let destPath = relFile;
    if (os === "win") {
      destPath = fixWinPath(relFile);
    }

    console.debug(" Preparing restore:");
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
      const result = await copyFileWithProgress(
        sourcePath,
        destPath,
        relFile,
        i,
        files.length,
        IPCRouter
      );

      IPCRouter.send("renderer", "action", JSON.stringify({
        type: "restoreBackupsResult",
        result,
      }));
    } catch (err) {
      console.error("   Copy failed:", err);
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
    ).map(f => normalizeRestorePath(
      os === "win" ? fixWinPath(f) : f
    ));

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

async function copyFileWithProgress(
  sourcePath: string,
  destRelPath: string,
  originalFilePath: string,
  fileIndex: number,
  totalFiles: number,
  IPCRouter: IPCMessageRouter
): Promise<{ file: string }> {
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

  const stat = await fsAsync.stat(sourcePath);
  const totalBytes = stat.size;

  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(sourcePath);
    const writeStream = fs.createWriteStream(destFullPath);

    let copiedBytes = 0;
    let lastEmit = Date.now();

    readStream.on("data", (chunk) => {
      copiedBytes += chunk.length;

      const now = Date.now();
      // throttle progress IPC to, say, every 200ms
      if (now - lastEmit > 200) {
        lastEmit = now;
        IPCRouter.send("renderer", "action", JSON.stringify({
          type: "restoreBackupsProgress",
          progress: {
            file: originalFilePath,
            fileIndex: fileIndex + 1,
            totalFiles,
            copiedBytes,
            totalBytes,
          },
        }));
      }
    });

    readStream.on("error", (err) => reject(err));
    writeStream.on("error", (err) => reject(err));

    writeStream.on("finish", () => {
      console.debug("   File copied successfully");
      // final 100% progress emit
      IPCRouter.send("renderer", "action", JSON.stringify({
        type: "restoreBackupsProgress",
        progress: {
          file: originalFilePath,
          fileIndex: fileIndex + 1,
          totalFiles,
          copiedBytes: totalBytes,
          totalBytes,
        },
      }));
      resolve({ file: originalFilePath });
    });

    readStream.pipe(writeStream);
  });
}


function normalizeRestorePath(relPath: string): string {
  const platform = getOS();

  if (platform === 'win') {
    // For Windows we already pre-normalize with fixWinPath
    return relPath;
  }

  // Split into path segments
  const parts = relPath.split(/[\\/]+/).filter(Boolean);

  if (platform === 'mac') {
    const idx = parts.indexOf('Users');
    if (idx >= 0) {
      return '/' + parts.slice(idx).join('/');
    }
  } else {
    const idx = parts.indexOf('home');
    if (idx >= 0) {
      return '/' + parts.slice(idx).join('/');
    }
  }

  // Fallbacks
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