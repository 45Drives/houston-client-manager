import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

const SEND_CHANNELS = new Set([
  'renderer-ready',
  'renderer-log',
  'logs:module-event',
  'IPCMessage',
  'log',
  'store-manual-creds',
]);

const INVOKE_CHANNELS = new Set([
  'verify-ssh-credentials',
  'install-cockpit-module',
  'setup-existing-server',
  'wait-for-server-api',
  'register-server-app',
  'add-manual-server',
  'get-os',
  'backup:isFirstRunNeeded',
  'mac:fdaStatus',
  'mac:openFdaSettings',
  'backup:validate-smb-credentials',
  'scan-network-fallback',
  'discovery:setEnabled',
  'is-dev',
  'dialog:openFolder',
  'dialog:openSshKey',
  'logs:list-client-files',
  'logs:read-client',
  'logs:read-server',
  'logs:read-backup-task',
  'credentials:store',
  'credentials:list',
  'credentials:remove',
  'credentials:retrieve',
  'credentials:update',
  'credentials:test-connection',
  'cred:list-servers',
  'cred:get-for',
  'cred:save',
  'cred:remove',
  'cred:set-favorite',
  'cred:set-name',
  'cred:touch',
  // Unified servers
  'servers:list',
  'servers:add',
  'servers:update',
  'servers:remove',
  'servers:set-favorite',
  'servers:touch',
  'get-client-ident',
  'session:clear-origin',
  'oauth:open',
  // Settings
  'settings:get',
  'settings:set',
  'settings:reset',
  // Auto-update
  'update:status',
  'update:check',
  'update:download',
  'update:install',
  // Server Management
  'server:probe',
  'server:apply-changes',
  'server:reboot',
  'server:manage',
  // WireShield
  'WireShield:status',
  'WireShield:initiate',
  'WireShield:join',
  'WireShield:poll',
  'WireShield:teardown',
  'WireShield:preflight',
  'WireShield:networkCheck',
  'WireShield:restart',
  'WireShield:addPeer',
  'WireShield:editPeer',
  'WireShield:removePeer',
  // Bulk Setup
  'bulk-setup:validate',
  'bulk-setup:probe',
  'bulk-setup:run',
  'bulk-setup:cancel',
  // Restore operations
  'restore:list-remotes',
  'restore:browse-remote',
  'restore:browse-server',
  'restore:list-s2s-tasks',
  'restore:list-zfs-replication-tasks',
  // Backup topology
  'topology:get-index',
  'topology:probe-server',
  'topology:forget-server',
  'restore:browse-s2s-remote',
  'restore:start',
  'restore:cancel',
  'restore:mkdir',
  'restore:create-zfs-dataset',
  // Snapshot operations
  'snapshot:list-datasets',
  'snapshot:list-snapshots',
  'snapshot:rollback',
  'snapshot:create',
  'snapshot:destroy',
  'snapshot:browse-files',
  'snapshot:restore-files',
]);

const RECEIVE_CHANNELS = new Set([
  'IPCMessage',
  'discovered-servers',
  'client-ip',
  'notification',
  'store-manual-creds',
  'setup-progress',
  'client-ident',
  'bulk-setup:progress',
  'bulk-setup:result',
  'bulk-setup:complete',
  'update:checking',
  'update:available',
  'update:none',
  'update:progress',
  'update:downloaded',
  'update:error',
]);

function assertAllowed(channel: string, set: Set<string>) {
  if (!set.has(channel)) {
    throw new Error(`Blocked IPC channel: ${channel}`);
  }
}

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel: string, data: any) => {
      assertAllowed(channel, SEND_CHANNELS);
      ipcRenderer.send(channel, data);
    },
    on: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) =>
      (assertAllowed(channel, RECEIVE_CHANNELS),
      ipcRenderer.on(channel, (_event, ...args) => listener(_event, ...args))),
    invoke: (channel: string, ...args: any[]) => {
      assertAllowed(channel, INVOKE_CHANNELS);
      return ipcRenderer.invoke(channel, ...args);
    },
    once: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) =>
      (assertAllowed(channel, RECEIVE_CHANNELS),
      ipcRenderer.once(channel, (_event, ...args) => listener(_event, ...args))),

    removeListener: (channel: string, listener: (...args: any[]) => void) => {
      assertAllowed(channel, RECEIVE_CHANNELS);
      ipcRenderer.removeListener(channel, listener);
    },
    removeAllListeners: (channel: string) => {
      assertAllowed(channel, RECEIVE_CHANNELS);
      ipcRenderer.removeAllListeners(channel);
    },
  },
  selectFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  getOS: () => ipcRenderer.invoke('get-os'),
  isFirstRunNeeded: (host: string, share: string, smbUser: string) =>
    ipcRenderer.invoke("backup:isFirstRunNeeded", host, share, smbUser),
  macFdaStatus: (source?: string) => ipcRenderer.invoke('mac:fdaStatus', source),
  macOpenFdaSettings: () => ipcRenderer.invoke('mac:openFdaSettings'),
  log: {
    debug: (...args: any[]) => ipcRenderer.send('renderer-log', { level: 'debug', args }),
    info: (...args: any[]) => ipcRenderer.send('renderer-log', { level: 'info', args }),
    warn: (...args: any[]) => ipcRenderer.send('renderer-log', { level: 'warn', args }),
    error: (...args: any[]) => ipcRenderer.send('renderer-log', { level: 'error', args }),
    log: (...args: any[]) => ipcRenderer.send('renderer-log', { level: 'log', args }),
  },
});

contextBridge.exposeInMainWorld('logger', {
  log: (...args: any[]) => ipcRenderer.send('log', { level: 'info', args }),
  warn: (...args: any[]) => ipcRenderer.send('log', { level: 'warn', args }),
  error: (...args: any[]) => ipcRenderer.send('log', { level: 'error', args }),
});
