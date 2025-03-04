/**
 * Should match main/preload.ts for TypeScript support in renderer
 */
export interface ElectronApi {  // ✅ Use named export
  ipcRenderer: {
    send: (channel: string, data: any) => void;
    on: (channel: string, callback: (...args: any[]) => void) => void;
  };
  selectFolder?: () => Promise<string>;
}

declare global {
  interface Window {
    electron: ElectronApi; // ✅ Declare globally only once
  }
}
