/**
 * Should match main/preload.ts for TypeScript support in renderer.
 * This is the authoritative type for window.electron in the renderer process.
 *
 * NOTE: Do not add `export` or `import` here — this must remain an ambient
 * declaration (script, not module) so that the global Window augmentation
 * is visible to all files without needing an explicit import.
 */
interface ElectronApi {
  ipcRenderer: {
    send: (channel: string, data: any) => void;
    on: (channel: string, callback: (...args: any[]) => void) => void;
    once: (channel: string, callback: (...args: any[]) => void) => void;
    invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>;
    removeListener: (channel: string, listener: (...args: any[]) => void) => void;
    removeAllListeners: (channel: string) => void;
  };
  selectFolder: () => Promise<string | null>;
  getOS: () => Promise<string>;
  isFirstRunNeeded: (host: string, share: string, smbUser: string) => Promise<boolean>;
  log: {
    debug: (...args: any[]) => void;
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
    log: (...args: any[]) => void;
  };
}

interface Window {
  electron: ElectronApi;
}
