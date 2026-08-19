import { ipcMain } from 'electron';
import { probeServerTopology } from '../topologyProbe';
import { loadSettings, saveSettings } from '../settingsStore';
import type { IPCHandlerContext } from './types';

export function registerTopologyHandlers(ctx: Pick<IPCHandlerContext, 'jsonLogger'>) {
  ipcMain.handle('topology:get-index', async () => {
    return loadSettings().topologyIndex ?? {};
  });

  ipcMain.handle(
    'topology:probe-server',
    async (_event, { host, username }: { host: string; username: string }) => {
      ctx.jsonLogger.info({ event: 'topology:probe-server', host });

      const result = await probeServerTopology(host, username);

      if (!result.reachable) {
        ctx.jsonLogger.warn({ event: 'topology:probe-server.unreachable', host, error: result.error });
        // Keep only the recorded identity; stale task lists would imply links that may be gone.
        const existing = loadSettings().topologyIndex?.[result.host];
        return { ...result, identity: existing?.identity };
      }

      const index = { ...(loadSettings().topologyIndex ?? {}), [result.host]: result };
      saveSettings({ topologyIndex: index });

      ctx.jsonLogger.info({
        event: 'topology:probe-server.done',
        host,
        rsync: result.rsyncTasks.length,
        replication: result.replicationTasks.length,
        cloudSync: result.cloudSyncTasks.length,
        cloudRemotes: result.cloudRemotes.length,
      });

      return result;
    },
  );

  ipcMain.handle('topology:forget-server', async (_event, host: string) => {
    const index = { ...(loadSettings().topologyIndex ?? {}) };
    delete index[host];
    saveSettings({ topologyIndex: index });
    return true;
  });
}
