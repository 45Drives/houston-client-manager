import { shell } from 'electron';
import { IPCRouter } from '../../../houston-common/houston-common-lib/lib/electronIPC/IPCRouter';
import { BackUpSetupConfigurator } from '../backup';
import type { BackUpSetupConfig, BackUpTask } from '@45drives/houston-common-lib';
import fetchBackups from '../backup/FetchBackups';
import fetchFilesInBackup from '../backup/FetchFilesFromBackup';
import restoreBackups from '../backup/RestoreBackups';
import { checkBackupTaskStatus } from '../backup/CheckSmbStatus';
import mountSmbPopup from '../smbMountPopup';
import { getOS, extractJsonFromOutput } from '../utils';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { execFileSync } from 'child_process';
import type { IPCHandlerContext } from './types';
import { getCredentialManager } from '../credentialManager';

/** Resolve SMB password: use provided password, or look it up from the credential vault */
function resolvePassword(host: string, share: string, user: string, pass: string): string {
  if (pass) return pass;
  const cm = getCredentialManager();
  const cred = user
    ? cm.retrieve(host, share, user)
    : cm.findByHostAndShare(host, share);
  return cred?.password ?? '';
}

/**
 * Try to mount an SMB share using the fstab entry created during backup setup.
 * Returns the mount point path on success, or null on failure.
 */
function tryFstabMount(host: string, share: string, user: string): string | null {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');
  const key = `${safe(host)}_${safe(share)}_${safe(user)}`;
  const mountPoint = `/mnt/houston-mounts/${key}`;

  // Already mounted?
  try {
    execFileSync('mountpoint', ['-q', mountPoint]);
    return mountPoint;
  } catch { /* not mounted */ }

  // Try fstab-based mount (uses credential file from backup setup)
  try {
    execFileSync('mount', [mountPoint], { timeout: 15000 });
    return mountPoint;
  } catch { /* fstab mount failed */ }

  return null;
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

export async function handleBackupMessage(message: any, ctx: IPCHandlerContext): Promise<boolean> {
  const router = IPCRouter.getInstance();

  switch (message.type) {
    case 'configureBackUp': {
      message.config.backUpTasks.forEach((backUpTask: BackUpTask) => {
        backUpTask.schedule.startDate = new Date(backUpTask.schedule.startDate);
      });
      const config: BackUpSetupConfig = message.config;
      ctx.jsonLogger.info({ event: 'configureBackUp', taskCount: config.backUpTasks.length });
      new BackUpSetupConfigurator().applyConfig(config, (progress) => {
        router.send('renderer', 'action', JSON.stringify({
          type: 'backUpSetupStatus',
          status: progress,
        }));
      });
      return true;
    }

    case 'fetchBackupsFromServer': {
      try {
        router.send('renderer', 'action', JSON.stringify({
          type: 'fetchBackupsFromServerResult',
          result: await fetchBackups(message.data, ctx.mainWindow),
        }));
      } catch (err: unknown) {
        router.send('renderer', 'action', JSON.stringify({
          type: 'fetchBackupsFromServerResult',
          result: { error: errMsg(err) || 'Failed to fetch backups' },
        }));
      }
      return true;
    }

    case 'fetchFilesFromBackup': {
      try {
        // Mount the share before listing files (it may not be mounted yet)
        const { smb_host, smb_share, smb_user, smb_pass } = message.data;

        // On Linux, try the fstab-based mount first (uses credential file, same path as backup script)
        if (getOS() !== 'mac' && getOS() !== 'win' && smb_host && smb_share && smb_user) {
          const fstabMount = tryFstabMount(smb_host, smb_share, smb_user);
          if (fstabMount) {
            message.data.mountPoint = fstabMount;
          }
        }

        // Fall back to mountSmbPopup if fstab didn't work
        if (!message.data.mountPoint && smb_host && smb_share) {
          const resolvedPass = resolvePassword(smb_host, smb_share, smb_user, smb_pass);
          try {
            const raw = await mountSmbPopup(smb_host, smb_share, smb_user || '', resolvedPass, ctx.mainWindow, 'silent');
            const mountResult = extractJsonFromOutput(raw);
            if (mountResult.MountPoint) {
              message.data.mountPoint = mountResult.MountPoint;
            }
          } catch (mountErr) {
            console.warn('fetchFilesFromBackup: mount attempt failed (share may already be mounted):', mountErr);
          }
        }
        router.send('renderer', 'action', JSON.stringify({
          type: 'fetchFilesFromBackupResult',
          result: await fetchFilesInBackup(message.data),
        }));
      } catch (err: unknown) {
        router.send('renderer', 'action', JSON.stringify({
          type: 'fetchFilesFromBackupResult',
          result: { error: errMsg(err) || 'Failed to fetch files' },
        }));
      }
      return true;
    }

    case 'restoreBackups': {
      ctx.jsonLogger.info({ event: 'restoreBackups_start', host: message.data?.smb_host, share: message.data?.smb_share });
      // Ensure the share is mounted before restoring files
      const { smb_host: rHost, smb_share: rShare, smb_user: rUser, smb_pass: rPass } = message.data;

      // On Linux, try the fstab-based mount first
      if (getOS() !== 'mac' && getOS() !== 'win' && rHost && rShare && rUser) {
        const fstabMount = tryFstabMount(rHost, rShare, rUser);
        if (fstabMount) {
          message.data.mountPoint = fstabMount;
        }
      }

      // Fall back to mountSmbPopup if fstab didn't work
      if (!message.data.mountPoint && rHost && rShare) {
        const resolvedRestorePass = resolvePassword(rHost, rShare, rUser, rPass);
        try {
          const raw = await mountSmbPopup(rHost, rShare, rUser || '', resolvedRestorePass, ctx.mainWindow, 'silent');
          const mountResult = extractJsonFromOutput(raw);
          if (mountResult.MountPoint) {
            message.data.mountPoint = mountResult.MountPoint;
          }
        } catch (mountErr) {
          console.warn('restoreBackups: mount attempt failed:', mountErr);
        }
      }
      await restoreBackups(message.data, router);
      ctx.jsonLogger.info({ event: 'restoreBackups_complete', host: rHost, share: rShare });
      return true;
    }

    case 'removeBackUpTask': {
      const task: BackUpTask = message.task;
      const backupManager = ctx.getBackUpManager();
      if (!backupManager) { ctx.notify('Error: No Backup Manager available.'); return true; }

      try {
        await backupManager.unschedule(task);
        ctx.jsonLogger.info({ event: 'removeBackUpTask_success', taskUuid: task.uuid, source: task.source, target: task.target });
        ctx.notify(`Successfully removed ${task.source} → ${task.target}`);
      } catch (err: unknown) {
        ctx.jsonLogger.error({ event: 'removeBackUpTask_error', taskUuid: task.uuid, error: errMsg(err) });
        ctx.notify(`Error deleting task: ${errMsg(err)}`);
        console.error('removeBackUpTask failed:', err);
      }

      const tasks = await backupManager.queryTasks();
      router.send('renderer', 'action', JSON.stringify({ type: 'sendBackupTasks', tasks }));
      return true;
    }

    case 'removeMultipleBackUpTasks': {
      const tasks: BackUpTask[] = message.tasks;
      const backupManager = ctx.getBackUpManager();
      if (!backupManager) { ctx.notify('Error: No Backup Manager available.'); return true; }

      try {
        if (backupManager.unscheduleSelectedTasks) {
          await backupManager.unscheduleSelectedTasks(tasks);
          ctx.jsonLogger.info({ event: 'removeMultipleBackUpTasks_success', count: tasks.length, taskUuids: tasks.map(t => t.uuid) });
          ctx.notify(`Successfully removed ${tasks.length} backup task(s)!`);
        } else {
          ctx.notify('Error: Backup Manager does not support bulk deletion.');
        }
      } catch (err: unknown) {
        ctx.jsonLogger.error({ event: 'removeMultipleBackUpTasks_error', count: tasks.length, error: errMsg(err) });
        ctx.notify(`Error: ${errMsg(err)}`);
        console.error('removeMultipleBackUpTasks failed:', err);
      }

      const updatedTasks = await backupManager.queryTasks();
      router.send('renderer', 'action', JSON.stringify({ type: 'sendBackupTasks', tasks: updatedTasks }));
      return true;
    }

    case 'updateBackUpTask': {
      const task: BackUpTask = message.task;
      const username: string = message.username || '';
      const password: string = message.password || '';
      const backupManager = ctx.getBackUpManager();
      if (!backupManager) { ctx.notify('Error: No Backup Manager available.'); return true; }

      try {
        await backupManager.updateSchedule(task, username, password);
        ctx.jsonLogger.info({ event: 'updateBackUpTask_success', taskUuid: task.uuid });
        const label = task.name || task.description;
        const date = new Date(task.schedule.startDate);
        const minute = date.getMinutes().toString().padStart(2, '0');
        const hour = date.getHours();
        ctx.notify(`Updated backup task "${label}" (schedule: ${hour}:${minute})`);
        // Refresh task list in UI
        const updatedTasks = await backupManager.queryTasks();
        router.send('renderer', 'action', JSON.stringify({ type: 'sendBackupTasks', tasks: updatedTasks }));
      } catch (err: unknown) {
        ctx.notify(`Error: ${errMsg(err)}`);
        ctx.jsonLogger.error({ event: 'updateBackUpTask_error', taskUuid: task.uuid, error: errMsg(err) });
        console.error('updateBackUpTask failed:', err);
      }
      return true;
    }

    case 'checkBackUpStatuses': {
      const tasks: BackUpTask[] = message.tasks;
      const updatedTasks: BackUpTask[] = [];
      for (const task of tasks) {
        try {
          task.status = await checkBackupTaskStatus(task);
        } catch (err) {
          console.error(`Status check failed for task: ${task.description}`, err);
          task.status = 'offline_connection_error';
        }
        updatedTasks.push(task);
      }
      router.send('renderer', 'action', JSON.stringify({ type: 'backUpStatusesUpdated', tasks: updatedTasks }));
      return true;
    }

    case 'requestBackUpTasksWithStatus': {
      const backUpManager = ctx.getBackUpManager();
      if (!backUpManager) { ctx.notify('Error: No Backup Manager available.'); return true; }
      try {
        const tasks = await backUpManager.queryTasks();
        router.send('renderer', 'action', JSON.stringify({ type: 'sendBackupTasks', tasks }));
      } catch (err: unknown) {
        ctx.notify(`Error: ${errMsg(err)}`);
        console.error('requestBackUpTasksWithStatus failed:', err);
      }
      return true;
    }

    case 'runBackUpTaskNow': {
      const backupManager = ctx.getBackUpManager();
      const task: BackUpTask = message.task;

      if (!backupManager?.runNow) {
        ctx.notify('Error: Run Now not supported for this OS');
        return true;
      }

      try {
        console.debug('Attempting to run backup:', task.description);
        ctx.notify(`Running backup task "${task.description}"...`);
        const result = await backupManager.runNow(task);

        // Check stdout/stderr for actual failure indicators even if exit code was "non-fatal"
        const output = `${result.stdout}\n${result.stderr}`;
        const hasMountError = /mount error\(\d+\)/i.test(output);
        const hasExplicitError = /\[ERROR\]/i.test(output);
        const hasRsyncSuccess = /\[SUCCESS\] rsync completed/i.test(output);
        const failed = hasMountError || hasExplicitError || (!hasRsyncSuccess && output.includes('Backup task'));

        if (result.stderr && result.stderr.trim() !== '') {
          console.warn('Backup completed with warnings/errors in stderr:', result.stderr);
        }

        console.debug('runNow completed:', result);

        if (failed) {
          // Extract a useful error message from the output
          const errorLines = output.split('\n').filter(l =>
            /mount error|ERROR|failed/i.test(l)
          ).map(l => l.trim()).filter(Boolean);
          const detail = errorLines.join('; ') || 'Check task log for details';
          ctx.jsonLogger.error({ event: 'runBackUpTaskNow_error', taskUuid: task.uuid, error: detail });
          ctx.notify(`Backup task "${task.description}" failed: ${detail}`);
        } else {
          ctx.jsonLogger.info({ event: 'runBackUpTaskNow_success', taskUuid: task.uuid, stderr: result.stderr || null });
          ctx.notify(`Backup task "${task.description}" completed successfully.`);
        }

        // Immediately send updated status and events so UI refreshes right away
        const sendStatusAndEvents = async () => {
          try {
            task.status = await checkBackupTaskStatus(task);
            router.send('renderer', 'action', JSON.stringify({ type: 'backUpStatusesUpdated', tasks: [task] }));

            // Re-send backup events so Last Run At updates in the UI
            const eventsLogPath = path.join(app.getPath('userData'), 'logs', '45drives_backup_events.json');
            if (fs.existsSync(eventsLogPath)) {
              const evLines = fs.readFileSync(eventsLogPath, 'utf8').split(/\r?\n/).filter(l => l.trim());
              const events: Array<{ uuid: string; host: string; share: string; source: string; timestamp: string; status: string }> = [];
              for (const l of evLines) {
                try { const ev = JSON.parse(l); if (ev.event === 'backup_end') events.push({ uuid: ev.uuid, host: ev.host, share: ev.share, source: ev.source, timestamp: ev.timestamp, status: ev.status }); } catch {}
              }
              router.send('renderer', 'action', JSON.stringify({ type: 'sendBackupEvents', events }));
            }
          } catch (err) {
            console.warn(`Post-runNow status update failed for ${task.description}`, err);
          }
        };

        // Send immediately (event log should be written by the script at this point)
        await sendStatusAndEvents();
        // Also send again after a short delay as a safety net
        setTimeout(sendStatusAndEvents, 3000);
      } catch (err: unknown) {
        console.error('runNow failed:', err);
        const msg = (err instanceof Error ? err.message : '') || (typeof err === 'object' && err !== null && 'stderr' in err ? String((err as Record<string, unknown>).stderr) : '') || JSON.stringify(err);
        ctx.jsonLogger.error({ event: 'runBackUpTaskNow_error', taskUuid: task.uuid, error: msg });
        ctx.notify(`Backup task "${task.description}" failed to run: ${msg}`);
      }
      return true;
    }

    case 'openBackupFolder': {
      const { smb_host, smb_share, smb_user, smb_pass, uuid } = message.data;
      try {
        let folderPath: string;
        if (getOS() === 'win') {
          const resolvedOpenPass = resolvePassword(smb_host, smb_share, smb_user, smb_pass);
          const raw = await mountSmbPopup(smb_host, smb_share, smb_user, resolvedOpenPass, ctx.mainWindow, 'silent');
          const mountResult = extractJsonFromOutput(raw);
          folderPath = path.join(mountResult.MountPoint, uuid);
        } else if (getOS() === 'mac') {
          // Try mountSmbPopup to get actual mount point, fall back to /Volumes/{share}
          try {
            const raw = await mountSmbPopup(smb_host, smb_share, smb_user, '', ctx.mainWindow, 'silent');
            const mountResult = extractJsonFromOutput(raw);
            folderPath = path.join(mountResult.MountPoint || `/Volumes/${smb_share}`, uuid);
          } catch {
            folderPath = path.join(`/Volumes/${smb_share}`, uuid);
          }
        } else {
          // On Linux, try the fstab-based mount first (same path the backup script uses)
          let mountBase = '';
          if (smb_host && smb_share && smb_user) {
            mountBase = tryFstabMount(smb_host, smb_share, smb_user) ?? '';
          }
          if (!mountBase) {
            // Fall back to mountSmbPopup
            const resolvedOpenPass = resolvePassword(smb_host, smb_share, smb_user, smb_pass);
            const raw = await mountSmbPopup(smb_host, smb_share, smb_user, resolvedOpenPass, ctx.mainWindow, 'silent');
            const mountResult = extractJsonFromOutput(raw);
            mountBase = (mountResult.MountPoint as string) || `/mnt/houston-mounts/${smb_share}`;
          }
          folderPath = path.join(mountBase, uuid);
        }

        if (!fs.existsSync(folderPath)) {
          ctx.notify(`Backup folder does not exist: ${folderPath}`);
          return true;
        }

        const openErr = await shell.openPath(folderPath);
        if (openErr) {
          ctx.notify(`Error opening folder: ${openErr}`);
        }
      } catch (err: unknown) {
        ctx.notify(`Failed to open backup folder: ${errMsg(err)}`);
        console.error('openBackupFolder failed:', err);
      }
      return true;
    }

    case 'openFolder': {
      const folderPath: string = message.path;
      try {
        console.debug('Trying to open folder:', folderPath);
        if (!fs.existsSync(folderPath)) { ctx.notify(`Folder does not exist: ${folderPath}`); return true; }
        if (!fs.statSync(folderPath).isDirectory()) { ctx.notify(`Not a directory: ${folderPath}`); return true; }

        shell.openPath(folderPath).then(result => {
          if (result) {
            console.error('shell.openPath failed:', result);
            ctx.notify(`Error opening folder: ${result}`);
          } else {
            ctx.notify(`Opened folder: ${folderPath}`);
          }
        });
      } catch (err) {
        ctx.notify(`Exception while opening folder: ${folderPath}`);
        console.error('Error opening folder:', folderPath, err);
      }
      return true;
    }

    case 'fetchBackupEvents': {
      const logPath = path.join(app.getPath('userData'), 'logs', '45drives_backup_events.json');
      let events: Array<{ uuid: string; host: string; share: string; source: string; timestamp: string; status: string }> = [];

      if (fs.existsSync(logPath)) {
        const lines = fs.readFileSync(logPath, 'utf8')
          .split(/\r?\n/)
          .filter(line => line.trim());
        for (const line of lines) {
          try {
            const ev = JSON.parse(line);
            if (ev.event === 'backup_end') {
              events.push({ uuid: ev.uuid, host: ev.host, share: ev.share, source: ev.source, timestamp: ev.timestamp, status: ev.status });
            }
          } catch { /* skip invalid JSON */ }
        }
      }
      router.send('renderer', 'action', JSON.stringify({ type: 'sendBackupEvents', events }));
      return true;
    }

    default:
      return false;
  }
}
