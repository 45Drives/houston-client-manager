import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel: string, data: any) => ipcRenderer.send(channel, data),
    on: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) =>
      ipcRenderer.on(channel, (_event, ...args) => listener(_event, ...args)),
    invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
    once: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) =>
      ipcRenderer.once(channel, (_event, ...args) => listener(_event, ...args)),

    removeListener: (channel: string, listener: (...args: any[]) => void) =>
      ipcRenderer.removeListener(channel, listener),    
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
