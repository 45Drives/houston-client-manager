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
    removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel),
  },
  selectFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  getOS: () => ipcRenderer.invoke('get-os'),
  isFirstRunNeeded: (host: string, share: string, smbUser: string) =>
    ipcRenderer.invoke("backup:isFirstRunNeeded", host, share, smbUser),
});

contextBridge.exposeInMainWorld('logger', {
  log: (...args: any[]) => ipcRenderer.send('log', { level: 'info', args }),
  warn: (...args: any[]) => ipcRenderer.send('log', { level: 'warn', args }),
  error: (...args: any[]) => ipcRenderer.send('log', { level: 'error', args }),
});
