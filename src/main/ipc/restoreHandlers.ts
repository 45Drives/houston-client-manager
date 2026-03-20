import { ipcMain } from 'electron';
import { IPCRouter } from '../../../houston-common/houston-common-lib/lib/electronIPC/IPCRouter';
import {
  listRemotes,
  browseRemote,
  browseServerPath,
  restoreToServer,
  stageForClientRestore,
  cancelRestore,
  listZfsDatasets,
  listZfsSnapshots,
  rollbackSnapshot,
  listS2STasks,
  browseS2SRemotePath,
} from '../restoreManager';
import type { IPCHandlerContext } from './types';
import type { RestoreProgressCallback } from '../restoreManager';

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
      return await listRemotes(serverIp, username);
    },
  );

  ipcMain.handle(
    'restore:browse-remote',
    async (_event, { serverIp, username, remote, remotePath }: {
      serverIp: string; username: string; remote: string; remotePath: string;
    }) => {
      ctx.jsonLogger.info({ event: 'restore:browse-remote', serverIp, remote, remotePath });
      return await browseRemote(serverIp, username, remote, remotePath);
    },
  );

  // ── Server file browsing ───────────────────────────────────────────────

  ipcMain.handle(
    'restore:browse-server',
    async (_event, { serverIp, username, serverPath }: {
      serverIp: string; username: string; serverPath: string;
    }) => {
      ctx.jsonLogger.info({ event: 'restore:browse-server', serverIp, serverPath });
      return await browseServerPath(serverIp, username, serverPath);
    },
  );

  // ── Server-to-Server task operations ───────────────────────────────────

  ipcMain.handle(
    'restore:list-s2s-tasks',
    async (_event, { serverIp, username }: { serverIp: string; username: string }) => {
      ctx.jsonLogger.info({ event: 'restore:list-s2s-tasks', serverIp });
      return await listS2STasks(serverIp, username);
    },
  );

  ipcMain.handle(
    'restore:browse-s2s-remote',
    async (_event, { serverIp, username, remoteHost, remotePort, remoteUser, remotePath }: {
      serverIp: string; username: string;
      remoteHost: string; remotePort: number; remoteUser: string; remotePath: string;
    }) => {
      ctx.jsonLogger.info({ event: 'restore:browse-s2s-remote', serverIp, remoteHost, remotePath });
      return await browseS2SRemotePath(serverIp, username, remoteHost, remotePort, remoteUser, remotePath);
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
      smbSharePath?: string;
    }) => {
      const operationId = crypto.randomUUID();
      const onProgress = makeProgressCallback(operationId);

      ctx.jsonLogger.info({
        event: 'restore:start',
        operationId,
        serverIp: opts.serverIp,
        source: opts.source,
        sourcePath: opts.sourcePath,
        target: opts.target,
      });

      if (opts.target === 'server') {
        return await restoreToServer(
          opts.serverIp,
          opts.username,
          opts.source,
          opts.sourcePath,
          opts.destPath,
          onProgress,
          operationId,
        );
      } else {
        // Stage to SMB share, then client pulls via existing restore pipeline
        if (!opts.smbSharePath) {
          return { success: false, error: 'smbSharePath is required for client restore' };
        }
        return await stageForClientRestore(
          opts.serverIp,
          opts.username,
          opts.source,
          opts.sourcePath,
          opts.smbSharePath,
          onProgress,
          operationId,
        );
      }
    },
  );

  ipcMain.handle(
    'restore:cancel',
    async (_event, { serverIp, username, operationId }: {
      serverIp: string; username: string; operationId: string;
    }) => {
      ctx.jsonLogger.info({ event: 'restore:cancel', operationId });
      return await cancelRestore(serverIp, username, operationId);
    },
  );

  // ── Snapshot operations ────────────────────────────────────────────────

  ipcMain.handle(
    'snapshot:list-datasets',
    async (_event, { serverIp, username }: { serverIp: string; username: string }) => {
      ctx.jsonLogger.info({ event: 'snapshot:list-datasets', serverIp });
      return await listZfsDatasets(serverIp, username);
    },
  );

  ipcMain.handle(
    'snapshot:list-snapshots',
    async (_event, { serverIp, username, dataset }: {
      serverIp: string; username: string; dataset?: string;
    }) => {
      ctx.jsonLogger.info({ event: 'snapshot:list-snapshots', serverIp, dataset });
      return await listZfsSnapshots(serverIp, username, dataset);
    },
  );

  ipcMain.handle(
    'snapshot:rollback',
    async (_event, { serverIp, username, snapshotName }: {
      serverIp: string; username: string; snapshotName: string;
    }) => {
      ctx.jsonLogger.warn({ event: 'snapshot:rollback', serverIp, snapshotName });
      return await rollbackSnapshot(serverIp, username, snapshotName);
    },
  );
}
