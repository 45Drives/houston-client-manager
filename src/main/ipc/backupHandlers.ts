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
import { startBackupProgressWatcher, clearTaskProgress } from '../backup/progressWatcher';
import { isSafeUuid } from '../backup/runRegistry';
import { removeBackupConfig, syncBackupConfig, getClientId } from '../backup/broadcasterApi';

/** Resolve SMB password: use provided password, or look it up from the credential vault */
function resolvePassword(host: string, share: string, user: string, pass: string): string {
  if (pass) return pass;
  const cm = getCredentialManager();
  // Try exact match first
  if (user) {
    const cred = cm.retrieve(host, share, user);
    if (cred?.password) return cred.password;
    // Fall back to wildcard share entry (e.g. stored via login without share)
    if (share !== '*') {
      const wildcard = cm.retrieve(host, '*', user);
      if (wildcard?.password) return wildcard.password;
    }
    return '';
  }
  // No user specified — search by host+share
  const cred = cm.findByHostAndShare(host, share);
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

/* Runs the user stopped. A cancelled run fails by definition, so its rejection has to be
 * told apart from a backup that broke on its own before anything is reported. */
const cancelledUuids = new Set<string>();

function eventLogPath(): string {
  return path.join(app.getPath('userData'), 'logs', '45drives_backup_events.json');
}

/**
 * Guarantee the run is closed out in the event log.
 *
 * The task script writes its own backup_end from a signal trap, but scripts written by an
 * older app version have no trap, and killing one leaves a backup_start with no partner —
 * which the UI reads as "still running" until the 12 hour staleness cutoff. Give the script
 * a moment to do it properly, then do it here if it did not.
 */
async function ensureCancelledEndEvent(task: BackUpTask): Promise<void> {
  await new Promise(r => setTimeout(r, 2500));

  const logFile = eventLogPath();
  let open = false;
  try {
    const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(l => l.trim());
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev.uuid !== task.uuid) continue;
        if (ev.event === 'backup_start') open = true;
        else if (ev.event === 'backup_end') open = false;
      } catch { /* skip invalid JSON */ }
    }
  } catch {
    return; // no log yet means no dangling start
  }
  if (!open) return;

  const record = {
    event: 'backup_end',
    timestamp: new Date().toISOString(),
    uuid: task.uuid,
    host: task.host,
    share: task.share,
    source: task.source,
    target: task.target,
    status: 'cancelled',
    smb_user: task.smb_user,
  };
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`);
  } catch { /* the UI falls back to the staleness cutoff */ }
}

export async function handleBackupMessage(message: any, ctx: IPCHandlerContext): Promise<boolean> {
  const router = IPCRouter.getInstance();
  startBackupProgressWatcher((taskUuid, percent, message) =>
    router.send('renderer', 'backupProgress', { taskUuid, percent, message })
  );

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

        // Remove config from broadcaster (best-effort)
        const host = task.host || task.target?.split(':')[0];
        if (host) {
          const cm = getCredentialManager();
          const share = task.share || task.target?.split(':')[1]?.split('/')[0];
          const cred = cm.findByHostAndShare(host, share || '');
          if (cred) removeBackupConfig(host, cred.username, cred.password, task.uuid).catch(() => {});
        }
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

          // Remove configs from broadcaster (best-effort)
          for (const t of tasks) {
            const host = t.host || t.target?.split(':')[0];
            if (host) {
              const cm = getCredentialManager();
              const share = t.share || t.target?.split(':')[1]?.split('/')[0];
              const cred = cm.findByHostAndShare(host, share || '');
              if (cred) removeBackupConfig(host, cred.username, cred.password, t.uuid).catch(() => {});
            }
          }
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
      const backupManager = ctx.getBackUpManager();
      if (!backupManager) { ctx.notify('Error: No Backup Manager available.'); return true; }

      // The schedule survives the IPC hop as an ISO string; the managers need a real Date.
      if (task.schedule?.startDate) task.schedule.startDate = new Date(task.schedule.startDate);

      const taskHost = task.host || task.target?.split(':')[0] || '';
      const taskShare = task.share || task.target?.split(':')[1]?.split('/')[0] || '';
      // Blank fields in the edit dialog mean "keep the existing credentials".
      const username: string = message.username || task.smb_user || '';
      const password: string = message.password || resolvePassword(taskHost, taskShare, username, '');

      if (!username || !password) {
        ctx.notify('Error: No saved credentials for this task. Enter the Samba username and password.');
        return true;
      }

      try {
        await backupManager.updateSchedule(task, username, password);
        ctx.jsonLogger.info({ event: 'updateBackUpTask_success', taskUuid: task.uuid });
        const label = task.name || task.description;
        const date = new Date(task.schedule.startDate);
        const minute = date.getMinutes().toString().padStart(2, '0');
        const hour = date.getHours();
        ctx.notify(`Updated backup task "${label}" (schedule: ${hour}:${minute})`);

        // Sync updated config to broadcaster (best-effort)
        if (taskHost) {
          syncBackupConfig(taskHost, username, password, task, getClientId()).catch(() => {});
        }

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

    case 'toggleBackUpTaskDisabled': {
      const task: BackUpTask = message.task;
      const disabled: boolean = message.disabled;
      const backupManager = ctx.getBackUpManager();
      if (!backupManager) { ctx.notify('Error: No Backup Manager available.'); return true; }

      try {
        const os = getOS();
        let scriptPath: string;

        if (os === 'win') {
          const USER_LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local');
          scriptPath = path.join(USER_LOCALAPPDATA, 'houston-backups', 'scripts', `Houston_Backup_Task_${task.uuid}.bat`);
        } else if (os === 'mac') {
          scriptPath = `/Library/Application Support/Houston/scripts/houston-backup-task-${task.uuid}.sh`;
        } else {
          scriptPath = path.join(require('os').homedir(), '.local', 'share', 'houston-backups', `Houston_Backup_Task_${task.uuid}.sh`);
        }

        if (fs.existsSync(scriptPath)) {
          let content = fs.readFileSync(scriptPath, 'utf-8');

          if (os === 'win') {
            // Update :: disabled = ... comment and the if check
            if (content.includes(':: disabled')) {
              content = content.replace(/^:: disabled\s*=\s*.*/m, `:: disabled    = ${disabled ? 'true' : 'false'}`);
            } else {
              content = content.replace(/^:: name\s*=\s*.*/m, (match) => `${match}\n:: disabled    = ${disabled ? 'true' : 'false'}`);
            }
            // Update the runtime check
            content = content.replace(/if "(?:true|false)"=="true"/, `if "${disabled ? 'true' : 'false'}"=="true"`);
          } else if (os === 'mac') {
            // Update # TASK_DISABLED="..." comment
            if (content.includes('# TASK_DISABLED=')) {
              content = content.replace(/# TASK_DISABLED="[^"]*"/, `# TASK_DISABLED="${disabled ? 'true' : 'false'}"`);
            } else {
              content = content.replace(/# TASK_NAME="[^"]*"/, (match) => `${match}\n# TASK_DISABLED="${disabled ? 'true' : 'false'}"`);
            }
            // Update the runtime check
            content = content.replace(/if \[ "(?:true|false)" = "true" \]/, `if [ "${disabled ? 'true' : 'false'}" = "true" ]`);
          } else {
            // Linux
            if (content.includes("DISABLED='")) {
              content = content.replace(/DISABLED='[^']*'/, `DISABLED='${disabled ? 'true' : 'false'}'`);
            } else {
              content = content.replace(/^(BACKUP_NAME='[^']*')$/m, `$1\nDISABLED='${disabled ? 'true' : 'false'}'`);
            }
          }
          fs.writeFileSync(scriptPath, content, { mode: os === 'win' ? undefined : 0o700 });
        }

        const label = task.name || task.description;
        ctx.notify(`Backup task "${label}" ${disabled ? 'disabled' : 'enabled'}.`);
        ctx.jsonLogger.info({ event: 'toggleBackUpTaskDisabled', taskUuid: task.uuid, disabled });
      } catch (err: unknown) {
        ctx.notify(`Error: ${errMsg(err)}`);
        ctx.jsonLogger.error({ event: 'toggleBackUpTaskDisabled_error', taskUuid: task.uuid, error: errMsg(err) });
      }

      const tasks = await backupManager.queryTasks();
      router.send('renderer', 'action', JSON.stringify({ type: 'sendBackupTasks', tasks }));
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

        // Progress callback: emit backupProgress over the IPC bus
        const onProgress = (percent: number | null, progressMsg?: string) => {
          router.send('renderer', 'backupProgress', {
            taskUuid: task.uuid,
            percent,
            message: progressMsg,
          });
        };
        onProgress(null, 'Starting backup...');
        cancelledUuids.delete(task.uuid);

        const result = await backupManager.runNow(task, onProgress);

        // Signal completion
        if (!cancelledUuids.has(task.uuid)) onProgress(100, 'Complete');

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
          if (cancelledUuids.has(task.uuid)) {
            ctx.jsonLogger.info({ event: 'runBackUpTaskNow_cancelled', taskUuid: task.uuid });
          } else {
            ctx.jsonLogger.error({ event: 'runBackUpTaskNow_error', taskUuid: task.uuid, error: detail });
            ctx.notify(`Backup task "${task.description}" failed: ${detail}`);
          }
        } else if (cancelledUuids.has(task.uuid)) {
          ctx.jsonLogger.info({ event: 'runBackUpTaskNow_cancelled', taskUuid: task.uuid });
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
        if (cancelledUuids.has(task.uuid)) {
          // The run died because the user stopped it; cancelBackUpTaskNow already reported it.
          ctx.jsonLogger.info({ event: 'runBackUpTaskNow_cancelled', taskUuid: task.uuid });
        } else {
          ctx.jsonLogger.error({ event: 'runBackUpTaskNow_error', taskUuid: task.uuid, error: msg });
          ctx.notify(`Backup task "${task.description}" failed to run: ${msg}`);
        }
      }
      return true;
    }

    case 'cancelBackUpTaskNow':
    case 'cancelMultipleBackUpTasks': {
      const backupManager = ctx.getBackUpManager();
      const requested: BackUpTask[] = message.tasks ?? (message.task ? [message.task] : []);

      if (!backupManager?.cancelNow) {
        ctx.notify('Error: Stopping a running backup is not supported for this OS');
        return true;
      }

      let knownTasks: BackUpTask[] = [];
      try { knownTasks = await backupManager.queryTasks(); } catch { /* fall back to the request */ }

      const stopped: BackUpTask[] = [];
      for (const requestedTask of requested) {
        const uuid = requestedTask?.uuid;
        if (!isSafeUuid(uuid)) continue;

        // Prefer the on-disk task: the renderer copy is only ever used to name the task.
        const task = knownTasks.find(t => t.uuid === uuid) ?? requestedTask;
        const label = task.name || task.description || uuid;

        cancelledUuids.add(uuid);
        router.send('renderer', 'backupProgress', { taskUuid: uuid, percent: null, message: 'Stopping…' });

        try {
          const result = await backupManager.cancelNow(task);
          ctx.jsonLogger.info({ event: 'cancelBackUpTaskNow', taskUuid: uuid, ...result });
          await ensureCancelledEndEvent(task);
          clearTaskProgress(uuid);
          ctx.notify(
            result.cancelled
              ? `Backup task "${label}" cancelled.`
              : `Backup task "${label}" was not running.`
          );
          stopped.push(task);
        } catch (err: unknown) {
          ctx.jsonLogger.error({ event: 'cancelBackUpTaskNow_error', taskUuid: uuid, error: errMsg(err) });
          ctx.notify(`Could not stop backup task "${label}": ${errMsg(err)}`);
        } finally {
          // Long enough for the in-flight runNow rejection to land, short enough that a
          // later genuine failure is still reported.
          setTimeout(() => cancelledUuids.delete(uuid), 60_000);
        }
      }

      // The renderer re-reads the event log whenever statuses change, which is what clears
      // the Running badge for scheduled runs.
      for (const task of stopped) {
        try { task.status = await checkBackupTaskStatus(task); } catch { /* status is cosmetic here */ }
      }
      if (stopped.length > 0) {
        router.send('renderer', 'action', JSON.stringify({ type: 'backUpStatusesUpdated', tasks: stopped }));
      }
      return true;
    }

    case 'openBackupFolder': {
      const { smb_host, smb_share, smb_user, smb_pass, uuid, client } = message.data;
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

        // Navigate into the hostname/client subfolder inside the UUID directory
        // The backup structure is: {mountpoint}/{uuid}/{hostname}/{source_path}/
        // Also contains .houston/ marker directory, so filter that out
        if (client && fs.existsSync(folderPath)) {
          try {
            const entries = fs.readdirSync(folderPath).filter(e => e !== '.houston');
            if (entries.length === 1 && fs.statSync(path.join(folderPath, entries[0])).isDirectory()) {
              // Single subfolder (the hostname) — descend into it, then into the client source path
              const hostDir = path.join(folderPath, entries[0]);
              const clientSubPath = client.replace(/^\/+/, '');
              const deepPath = path.join(hostDir, clientSubPath);
              if (fs.existsSync(deepPath)) {
                folderPath = deepPath;
              } else {
                folderPath = hostDir;
              }
            }
          } catch { /* fall through to default folderPath */ }
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
      // Track which UUIDs have started but not ended (still running),
      // along with their start timestamp so we can detect stale entries.
      const startedUuids = new Map<string, string>(); // uuid → timestamp

      // Maximum age (ms) for a backup_start without backup_end before
      // we consider it stale (crashed/interrupted). 12 hours.
      const MAX_RUNNING_AGE_MS = 12 * 60 * 60 * 1000;

      // How long a Windows console log may go without a write before the run is presumed dead.
      const WIN_RUNNING_STALE_MS = 5 * 60 * 1000;

      if (fs.existsSync(logPath)) {
        const lines = fs.readFileSync(logPath, 'utf8')
          .split(/\r?\n/)
          .filter(line => line.trim());
        for (const line of lines) {
          try {
            const ev = JSON.parse(line);
            if (ev.event === 'backup_start' && ev.uuid) {
              startedUuids.set(ev.uuid, ev.timestamp || '');
            }
            if (ev.event === 'backup_end') {
              startedUuids.delete(ev.uuid);
              events.push({ uuid: ev.uuid, host: ev.host, share: ev.share, source: ev.source, timestamp: ev.timestamp, status: ev.status });
            }
          } catch { /* skip invalid JSON */ }
        }
      }

      // Prune stale "running" entries: if backup_start is older than MAX_RUNNING_AGE_MS,
      // the process almost certainly crashed or was killed without writing backup_end.
      const now = Date.now();
      for (const [uuid, ts] of startedUuids) {
        const startMs = ts ? Date.parse(ts) : NaN;
        if (Number.isFinite(startMs) && now - startMs > MAX_RUNNING_AGE_MS) {
          startedUuids.delete(uuid);
        }
      }

      // Filter out UUIDs whose tasks no longer exist (deleted tasks)
      if (startedUuids.size > 0) {
        const backupManager = ctx.getBackUpManager();
        if (backupManager) {
          try {
            const existingTasks = await backupManager.queryTasks();
            const existingUuids = new Set(existingTasks.map(t => t.uuid));
            for (const uuid of startedUuids.keys()) {
              if (!existingUuids.has(uuid)) {
                startedUuids.delete(uuid);
              }
            }
          } catch { /* if queryTasks fails, keep startedUuids as-is */ }
        }
      }

      // Verify a backup process is actually running for each UUID.
      // If the script crashed without writing backup_end, the event log
      // will have a stale backup_start. Check for the actual process.
      if (startedUuids.size > 0 && getOS() !== 'win') {
        for (const uuid of [...startedUuids.keys()]) {
          try {
            // Linux names its scripts Houston_Backup_Task_<uuid>.sh, macOS
            // houston-backup-task-<uuid>.sh; pgrep -f takes an extended regex.
            execFileSync('pgrep', ['-f', `(Houston_Backup_Task_|houston-backup-task-)${uuid}`], { stdio: 'ignore' });
            // pgrep succeeded — process is running, keep it
          } catch {
            // pgrep failed (exit code 1) — no matching process, stale entry
            startedUuids.delete(uuid);
          }
        }
      } else if (startedUuids.size > 0) {
        // No pgrep on Windows. The action script self-captures its console output, so a log
        // that has stopped growing is the equivalent signal that the run is gone.
        const consoleDir = path.join(app.getPath('userData'), 'logs');
        for (const uuid of [...startedUuids.keys()]) {
          try {
            const stat = fs.statSync(path.join(consoleDir, `Houston_Backup_Task_${uuid}.console.log`));
            if (now - stat.mtimeMs > WIN_RUNNING_STALE_MS) startedUuids.delete(uuid);
          } catch {
            startedUuids.delete(uuid);
          }
        }
      }

      router.send('renderer', 'action', JSON.stringify({
        type: 'sendBackupEvents',
        events,
        runningUuids: Array.from(startedUuids.keys()),
      }));
      return true;
    }

    default:
      return false;
  }
}
