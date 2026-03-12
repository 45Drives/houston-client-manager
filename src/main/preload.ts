import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

const SEND_CHANNELS = new Set([
  'renderer-ready',
  'renderer-log',
  'IPCMessage',
  'log',
]);

const INVOKE_CHANNELS = new Set([
  'install-cockpit-module',
  'get-os',
  'backup:isFirstRunNeeded',
  'scan-network-fallback',
  'discovery:setEnabled',
  'is-dev',
  'dialog:openFolder',
]);

const RECEIVE_CHANNELS = new Set([
  'IPCMessage',
  'discovered-servers',
  'client-ip',
  'notification',
  'store-manual-creds',
  'setup-progress',
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
  },
  selectFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  getOS: () => ipcRenderer.invoke('get-os'),
  isFirstRunNeeded: (host: string, share: string) =>
    ipcRenderer.invoke("backup:isFirstRunNeeded", host, share),
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
