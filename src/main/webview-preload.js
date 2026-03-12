import { contextBridge, ipcRenderer } from 'electron';

const ALLOWED_CHANNELS = new Set(["IPCMessage"]);

function isAllowed(channel) {
  return ALLOWED_CHANNELS.has(channel);
}

document.addEventListener(
  'DOMContentLoaded',
  () => {
    contextBridge.exposeInMainWorld('electron', {
      ipcRenderer: {
        send: (channel, data) => {
          if (!isAllowed(channel)) return;
          ipcRenderer.send(channel, data);
        },
        on: (channel, callback) => {
          if (!isAllowed(channel)) return () => {};
          const wrapped = (_event, ...args) => callback(_event, ...args);
          ipcRenderer.on(channel, wrapped);
          return () => ipcRenderer.removeListener(channel, wrapped);
        },
        invoke: () => {
          return Promise.reject(new Error("ipcRenderer.invoke is not permitted in webview"));
        },
        removeListener: () => {},
        removeAllListeners: () => {},
      },
    });
  },
  false
);
