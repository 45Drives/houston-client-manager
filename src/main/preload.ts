import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel: string, data: any) => ipcRenderer.send(channel, data),
    on: (channel: string, callback: (...args: any[]) => void) =>
      ipcRenderer.on(channel, callback),
    invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args), // Ensure this line is included
  },
  selectFolder: () => ipcRenderer.invoke('dialog:openFolder'),
});
