import { contextBridge, ipcRenderer } from 'electron';

document.addEventListener(
  'DOMContentLoaded',
  () => {
    contextBridge.exposeInMainWorld('electron', {
      ipcRenderer: {
        send: (channel, data) => ipcRenderer.send(channel, data),
        on: (channel, callback) =>
          ipcRenderer.on(channel, callback),
      },
    });

  },
  false
);

