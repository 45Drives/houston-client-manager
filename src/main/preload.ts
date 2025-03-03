import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel: string, data: any) => ipcRenderer.send(channel, data),
    on: (channel: string, callback: (...args: any[]) => void) =>
      ipcRenderer.on(channel, callback),
  },
  selectFolder: () => ipcRenderer.invoke('dialog:openFolder'),
});
