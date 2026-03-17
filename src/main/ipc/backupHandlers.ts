import { shell } from 'electron';
import { IPCRouter } from '../../../houston-common/houston-common-lib/lib/electronIPC/IPCRouter';
import { BackUpSetupConfigurator } from '../backup';
import type { BackUpSetupConfig, BackUpTask } from '@45drives/houston-common-lib';
import fetchBackups from '../backup/FetchBackups';
import fetchFilesInBackup from '../backup/FetchFilesFromBackup';
import restoreBackups from '../backup/RestoreBackups';
import { checkBackupTaskStatus } from '../backup/CheckSmbStatus';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { IPCHandlerContext } from './types';

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
      await restoreBackups(message.data, router);
      return true;
    }

    case 'removeBackUpTask': {
      const task: BackUpTask = message.task;
      const backupManager = ctx.getBackUpManager();
      if (!backupManager) { ctx.notify('Error: No Backup Manager available.'); return true; }

      try {
        await backupManager.unschedule(task);
        ctx.notify(`Successfully removed ${task.source} → ${task.target}`);
      } catch (err: unknown) {
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
          ctx.notify(`Successfully removed ${tasks.length} backup task(s)!`);
        } else {
          ctx.notify('Error: Backup Manager does not support bulk deletion.');
        }
      } catch (err: unknown) {
        ctx.notify(`Error: ${errMsg(err)}`);
        console.error('removeMultipleBackUpTasks failed:', err);
      }

      const updatedTasks = await backupManager.queryTasks();
      router.send('renderer', 'action', JSON.stringify({ type: 'sendBackupTasks', tasks: updatedTasks }));
      return true;
    }

    case 'updateBackUpTask': {
      const task: BackUpTask = message.task;
      const username: string = message.username;
      const password: string = message.password;
      const backupManager = ctx.getBackUpManager();
      if (!backupManager) { ctx.notify('Error: No Backup Manager available.'); return true; }

      try {
        await backupManager.updateSchedule(task, username, password);
        ctx.jsonLogger.info({ event: 'updateBackUpTask_success', taskUuid: task.uuid });
        const date = new Date(task.schedule.startDate);
        const minute = date.getMinutes().toString().padStart(2, '0');
        const hour = date.getHours();
        ctx.notify(`Updated task schedule for ${task.description} to ${hour}:${minute}`);
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
        const result = await backupManager.runNow(task);

        if (result.stderr && result.stderr.trim() !== '') {
          console.warn('Backup completed with warnings/errors in stderr:', result.stderr);
        }

        console.debug('runNow completed:', result);
        ctx.jsonLogger.info({ event: 'runBackUpTaskNow_success', taskUuid: task.uuid, stderr: result.stderr || null });
        ctx.notify(`Backup task "${task.description}" started successfully.`);

        setTimeout(async () => {
          try {
            task.status = await checkBackupTaskStatus(task);
            router.send('renderer', 'action', JSON.stringify({ type: 'backUpStatusesUpdated', tasks: [task] }));
          } catch (err) {
            console.warn(`Post-runNow status update failed for ${task.description}`, err);
          }
        }, 5000);
      } catch (err: unknown) {
        console.error('runNow failed:', err);
        const msg = (err instanceof Error ? err.message : '') || (typeof err === 'object' && err !== null && 'stderr' in err ? String((err as Record<string, unknown>).stderr) : '') || JSON.stringify(err);
        ctx.jsonLogger.error({ event: 'runBackUpTaskNow_error', taskUuid: task.uuid, error: msg });
        ctx.notify(`Backup task "${task.description}" failed to run: ${msg}`);
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
