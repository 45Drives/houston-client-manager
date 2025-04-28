const { ipcMain } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// This directory is where we'll restore to
const LOCAL_RESTORE_DIR = path.join(os.homedir(), 'RestoredBackups');

ipcMain.on('restore-files', (event, payload) => {
  const { target, folder, files } = payload;

  if (!target || !folder || !files || files.length === 0) {
    console.error('Invalid restore payload:', payload);
    return;
  }

  console.log('Restoring files from:', target);
  console.log('Files:', files);

  // Make sure restore directory exists
  if (!fs.existsSync(LOCAL_RESTORE_DIR)) {
    fs.mkdirSync(LOCAL_RESTORE_DIR, { recursive: true });
  }

  files.forEach((filePath) => {
    const fileName = path.basename(filePath);
    const remoteFile = `${target}:"${filePath}"`;
    const localPath = path.join(LOCAL_RESTORE_DIR, fileName);

    const scpCommand = `scp ${remoteFile} "${localPath}"`;

    console.log('Executing:', scpCommand);

    exec(scpCommand, (error, stdout, stderr) => {
      if (error) {
        console.error(`SCP failed for ${filePath}:`, error.message);
        event.reply('restore-status', {
          file: filePath,
          success: false,
          error: error.message,
        });
        return;
      }

      console.log(`Restored ${filePath} to ${localPath}`);
      event.reply('restore-status', {
        file: filePath,
        success: true,
      });
    });
  });
});
