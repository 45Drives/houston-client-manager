import { ipcMain } from 'electron';
import { IPCRouter } from '../../../houston-common/houston-common-lib/lib/electronIPC/IPCRouter';
import {
  listRemotes,
  browseRemote,
  browseServerPath,
  restoreToServer,
  restoreToClient,
  restoreFromS2S,
  restoreS2SToClient,
  cancelRestore,
  createServerDirectory,
  createZfsDatasetOnServer,
  listZfsDatasets,
  listZfsSnapshots,
  rollbackSnapshot,
  createZfsSnapshot,
  destroyZfsSnapshot,
  browseSnapshotFiles,
  restoreFromSnapshot,
  listS2STasks,
  listZfsReplicationTasks,
  browseS2SRemotePath,
  getReplicationAnchors,
} from '../restoreManager';
import type { IPCHandlerContext } from './types';
import type { RestoreProgressCallback } from '../restoreManager';
import { loadSettings, saveSettings, type RestoreHistoryEntry } from '../settingsStore';

/**
 * Register all restore + snapshot IPC handlers.
 * These use the ipcMain.handle / ipcRenderer.invoke pattern for clean
 * request/response semantics (not the fire-and-forget message bus).
 *
 * Progress updates for long-running operations are pushed to the renderer
 * via the IPCMessageRouter bus on the 'restoreProgress' channel.
 */
export function registerRestoreHandlers(ctx: IPCHandlerContext) {
  const router = IPCRouter.getInstance();

  // Helper: push progress to renderer via the typed message bus
  function makeProgressCallback(operationId: string): RestoreProgressCallback {
    return (progress) => {
      router.send('renderer', 'restoreProgress', progress);
    };
  }

  // ── Cloud remote operations ────────────────────────────────────────────

  ipcMain.handle(
    'restore:list-remotes',
    async (_event, { serverIp, username }: { serverIp: string; username: string }) => {
      ctx.jsonLogger.info({ event: 'restore:list-remotes', serverIp });
      const result = await listRemotes(serverIp, username);
      ctx.jsonLogger.info({ event: 'restore:list-remotes.done', serverIp, count: Array.isArray(result) ? result.length : 0 });
      return result;
    },
  );

  ipcMain.handle(
    'restore:browse-remote',
    async (_event, { serverIp, username, remote, remotePath }: {
      serverIp: string; username: string; remote: string; remotePath: string;
    }) => {
      ctx.jsonLogger.info({ event: 'restore:browse-remote', serverIp, remote, remotePath });
      const result = await browseRemote(serverIp, username, remote, remotePath);
      ctx.jsonLogger.info({ event: 'restore:browse-remote.done', serverIp, remote, remotePath, count: Array.isArray(result) ? result.length : 0 });
      return result;
    },
  );

  // ── Server file browsing ───────────────────────────────────────────────

  ipcMain.handle(
    'restore:browse-server',
    async (_event, { serverIp, username, serverPath }: {
      serverIp: string; username: string; serverPath: string;
    }) => {
      ctx.jsonLogger.info({ event: 'restore:browse-server', serverIp, serverPath });
      const result = await browseServerPath(serverIp, username, serverPath);
      ctx.jsonLogger.info({ event: 'restore:browse-server.done', serverIp, serverPath, count: Array.isArray(result) ? result.length : 0 });
      return result;
    },
  );

  // ── Server-to-Server task operations ───────────────────────────────────

  ipcMain.handle(
    'restore:list-s2s-tasks',
    async (_event, { serverIp, username }: { serverIp: string; username: string }) => {
      ctx.jsonLogger.info({ event: 'restore:list-s2s-tasks', serverIp });
      const result = await listS2STasks(serverIp, username);
      ctx.jsonLogger.info({ event: 'restore:list-s2s-tasks.done', serverIp, count: Array.isArray(result) ? result.length : 0 });
      return result;
    },
  );

  ipcMain.handle(
    'restore:browse-s2s-remote',
    async (_event, { serverIp, username, remoteHost, remotePort, remoteUser, remotePath }: {
      serverIp: string; username: string;
      remoteHost: string; remotePort: number; remoteUser: string; remotePath: string;
    }) => {
      ctx.jsonLogger.info({ event: 'restore:browse-s2s-remote', serverIp, remoteHost, remotePath });
      const result = await browseS2SRemotePath(serverIp, username, remoteHost, remotePort, remoteUser, remotePath);
      ctx.jsonLogger.info({ event: 'restore:browse-s2s-remote.done', serverIp, remoteHost, remotePath, count: Array.isArray(result) ? result.length : 0 });
      return result;
    },
  );

  ipcMain.handle(
    'restore:list-zfs-replication-tasks',
    async (_event, { serverIp, username }: { serverIp: string; username: string }) => {
      ctx.jsonLogger.info({ event: 'restore:list-zfs-replication-tasks', serverIp });
      try {
        const result = await listZfsReplicationTasks(serverIp, username);
        ctx.jsonLogger.info({ event: 'restore:list-zfs-replication-tasks.done', serverIp, count: Array.isArray(result) ? result.length : 0 });
        return result;
      } catch (err: unknown) {
        // Topology probing is best-effort; an unreachable server must not surface as a handler crash.
        const error = err instanceof Error ? err.message : String(err);
        ctx.jsonLogger.warn({ event: 'restore:list-zfs-replication-tasks.failed', serverIp, error });
        return [];
      }
    },
  );

  // ── Restore execution ──────────────────────────────────────────────────

  ipcMain.handle(
    'restore:start',
    async (_event, opts: {
      serverIp: string;
      username: string;
      source: string;
      sourcePath: string;
      destPath: string;
      target: 'server' | 'client';
      s2sTask?: { remoteHost: string; remotePort: number; remoteUser: string };
      selectedFiles?: string[];
    }) => {
      const operationId = crypto.randomUUID();
      const onProgress = makeProgressCallback(operationId);

      const fileCount = opts.selectedFiles?.length ?? 0;
      ctx.jsonLogger.info({
        event: 'restore:start',
        operationId,
        serverIp: opts.serverIp,
        source: opts.source,
        sourcePath: opts.sourcePath,
        destPath: opts.destPath,
        target: opts.target,
        fileCount: fileCount || 'all',
        isS2S: !!opts.s2sTask,
      });

      let result: any;
      try {

      // S2S restores use rsync over SSH hop, not rclone
      if (opts.s2sTask) {
        if (opts.target === 'server') {
          result = await restoreFromS2S(
            opts.serverIp,
            opts.username,
            opts.s2sTask.remoteHost,
            opts.s2sTask.remotePort,
            opts.s2sTask.remoteUser,
            opts.sourcePath,
            opts.destPath,
            onProgress,
            operationId,
            opts.selectedFiles,
          );
        } else {
          result = await restoreS2SToClient(
            opts.serverIp,
            opts.username,
            opts.s2sTask.remoteHost,
            opts.s2sTask.remotePort,
            opts.s2sTask.remoteUser,
            opts.sourcePath,
            opts.destPath,
            onProgress,
            operationId,
            opts.selectedFiles,
          );
        }
      } else if (opts.target === 'server') {
        result = await restoreToServer(
          opts.serverIp,
          opts.username,
          opts.source,
          opts.sourcePath,
          opts.destPath,
          onProgress,
          operationId,
          opts.selectedFiles,
        );
      } else {
        result = await restoreToClient(
          opts.serverIp,
          opts.username,
          opts.source,
          opts.sourcePath,
          opts.destPath,
          onProgress,
          operationId,
          opts.selectedFiles,
        );
      }

      const logLevel = result?.success ? 'info' : 'error';
      ctx.jsonLogger[logLevel]({
        event: result?.success ? 'restore:complete' : 'restore:failed',
        operationId,
        serverIp: opts.serverIp,
        source: opts.source,
        sourcePath: opts.sourcePath,
        destPath: opts.destPath,
        target: opts.target,
        success: result?.success,
        error: result?.error,
      });

      // Persist restore history entry
      try {
        const sourceType: RestoreHistoryEntry['sourceType'] = opts.s2sTask ? 's2s' : 'cloud';
        const entry: RestoreHistoryEntry = {
          timestamp: Date.now(),
          source: opts.source,
          sourcePath: opts.sourcePath,
          destPath: opts.destPath,
          target: opts.target,
          sourceType,
          fileCount: opts.selectedFiles?.length ?? 'all',
          success: !!result?.success,
          error: result?.error,
        };
        const settings = loadSettings();
        const history = [entry, ...(settings.restoreHistory || [])].slice(0, 20);
        saveSettings({ restoreHistory: history });
      } catch { /* non-critical */ }

      return result;

      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        ctx.jsonLogger.error({
          event: 'restore:failed',
          operationId,
          serverIp: opts.serverIp,
          source: opts.source,
          target: opts.target,
          error,
        });

        // Persist failed restore history entry
        try {
          const sourceType: RestoreHistoryEntry['sourceType'] = opts.s2sTask ? 's2s' : 'cloud';
          const entry: RestoreHistoryEntry = {
            timestamp: Date.now(),
            source: opts.source,
            sourcePath: opts.sourcePath,
            destPath: opts.destPath,
            target: opts.target,
            sourceType,
            fileCount: opts.selectedFiles?.length ?? 'all',
            success: false,
            error,
          };
          const settings = loadSettings();
          const history = [entry, ...(settings.restoreHistory || [])].slice(0, 20);
          saveSettings({ restoreHistory: history });
        } catch { /* non-critical */ }

        return { success: false, error };
      }
    },
  );

  ipcMain.handle(
    'restore:cancel',
    async (_event, { serverIp, username, operationId }: {
      serverIp: string; username: string; operationId: string;
    }) => {
      ctx.jsonLogger.warn({ event: 'restore:cancel', serverIp, operationId });
      const result = await cancelRestore(serverIp, username, operationId);
      ctx.jsonLogger.info({ event: 'restore:cancel.done', operationId, success: !!result });
      return result;
    },
  );

  ipcMain.handle(
    'restore:mkdir',
    async (_event, { serverIp, username, dirPath }: {
      serverIp: string; username: string; dirPath: string;
    }) => {
      ctx.jsonLogger.info({ event: 'restore:mkdir', serverIp, dirPath });
      const result = await createServerDirectory(serverIp, username, dirPath);
      ctx.jsonLogger[result?.success ? 'info' : 'error']({ event: 'restore:mkdir.done', serverIp, dirPath, success: result?.success, error: result?.error });
      return result;
    },
  );

  ipcMain.handle(
    'restore:create-zfs-dataset',
    async (_event, { serverIp, username, datasetName, mountpoint }: {
      serverIp: string; username: string; datasetName: string; mountpoint?: string;
    }) => {
      ctx.jsonLogger.info({ event: 'restore:create-zfs-dataset', serverIp, datasetName, mountpoint });
      const result = await createZfsDatasetOnServer(serverIp, username, datasetName, mountpoint);
      ctx.jsonLogger[result?.success ? 'info' : 'error']({ event: 'restore:create-zfs-dataset.done', serverIp, datasetName, success: result?.success, error: result?.error });
      return result;
    },
  );

  // ── Snapshot operations ────────────────────────────────────────────────

  ipcMain.handle(
    'snapshot:list-datasets',
    async (_event, { serverIp, username, password }: { serverIp: string; username: string; password?: string }) => {
      ctx.jsonLogger.info({ event: 'snapshot:list-datasets', serverIp });
      const result = await listZfsDatasets(serverIp, username, password);
      ctx.jsonLogger.info({ event: 'snapshot:list-datasets.done', serverIp, count: Array.isArray(result) ? result.length : 0 });
      return result;
    },
  );

  ipcMain.handle(
    'snapshot:list-snapshots',
    async (_event, { serverIp, username, dataset }: {
      serverIp: string; username: string; dataset?: string;
    }) => {
      ctx.jsonLogger.info({ event: 'snapshot:list-snapshots', serverIp, dataset });
      const result = await listZfsSnapshots(serverIp, username, dataset);
      ctx.jsonLogger.info({ event: 'snapshot:list-snapshots.done', serverIp, dataset, count: Array.isArray(result) ? result.length : 0 });
      return result;
    },
  );

  ipcMain.handle(
    'snapshot:rollback',
    async (_event, { serverIp, username, snapshotName }: {
      serverIp: string; username: string; snapshotName: string;
    }) => {
      ctx.jsonLogger.warn({ event: 'snapshot:rollback', serverIp, snapName: snapshotName });
      const result = await rollbackSnapshot(serverIp, username, snapshotName);
      ctx.jsonLogger[result?.success ? 'info' : 'error']({ event: 'snapshot:rollback.done', serverIp, snapName: snapshotName, success: result?.success, error: result?.error });
      return result;
    },
  );

  ipcMain.handle(
    'snapshot:create',
    async (_event, { serverIp, username, dataset, snapName, recursive }: {
      serverIp: string; username: string; dataset: string; snapName: string; recursive?: boolean;
    }) => {
      ctx.jsonLogger.info({ event: 'snapshot:create', serverIp, dataset, snapName, recursive });
      const result = await createZfsSnapshot(serverIp, username, dataset, snapName, recursive);
      ctx.jsonLogger[result?.success ? 'info' : 'error']({ event: 'snapshot:create.done', serverIp, dataset, snapName, success: result?.success, error: result?.error });
      return result;
    },
  );

  ipcMain.handle(
    'snapshot:destroy',
    async (_event, { serverIp, username, snapshotName, recursive }: {
      serverIp: string; username: string; snapshotName: string; recursive?: boolean;
    }) => {
      ctx.jsonLogger.warn({ event: 'snapshot:destroy', serverIp, snapName: snapshotName, recursive });
      const result = await destroyZfsSnapshot(serverIp, username, snapshotName, recursive);
      ctx.jsonLogger[result?.success ? 'info' : 'error']({ event: 'snapshot:destroy.done', serverIp, snapName: snapshotName, success: result?.success, error: result?.error });
      return result;
    },
  );

  ipcMain.handle(
    'snapshot:browse-files',
    async (_event, { serverIp, username, dataset, snapName, subPath }: {
      serverIp: string; username: string; dataset: string; snapName: string; subPath?: string;
    }) => {
      ctx.jsonLogger.info({ event: 'snapshot:browse-files', serverIp, dataset, snapName, subPath });
      const result = await browseSnapshotFiles(serverIp, username, dataset, snapName, subPath);
      ctx.jsonLogger.info({ event: 'snapshot:browse-files.done', serverIp, dataset, snapName, subPath, count: Array.isArray(result) ? result.length : 0 });
      return result;
    },
  );

  ipcMain.handle(
    'snapshot:restore-files',
    async (_event, { serverIp, username, dataset, snapName, filePaths, destPath }: {
      serverIp: string; username: string; dataset: string; snapName: string;
      filePaths: string[]; destPath: string;
    }) => {
      ctx.jsonLogger.info({ event: 'snapshot:restore-files', serverIp, dataset, snapName, fileCount: filePaths.length, destPath });
      const result = await restoreFromSnapshot(serverIp, username, dataset, snapName, filePaths, destPath);
      ctx.jsonLogger[result?.success ? 'info' : 'error']({ event: 'snapshot:restore-files.done', serverIp, dataset, snapName, fileCount: filePaths.length, destPath, success: result?.success, error: result?.error });
      return result;
    },
  );

  ipcMain.handle(
    'snapshot:get-replication-anchors',
    async (_event, { serverIp, username, dataset }: {
      serverIp: string; username: string; dataset: string;
    }) => {
      ctx.jsonLogger.info({ event: 'snapshot:get-replication-anchors', serverIp, dataset });
      const result = await getReplicationAnchors(serverIp, username, dataset);
      ctx.jsonLogger.info({ event: 'snapshot:get-replication-anchors.done', serverIp, dataset, count: result.length });
      return result;
    },
  );
}
