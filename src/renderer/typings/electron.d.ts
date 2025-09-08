/**
 * Should match main/preload.ts for TypeScript support in renderer
 */
export interface ElectronApi {  //  Use named export
  ipcRenderer: {
    send: (channel: string, data: any) => void;
    on: (channel: string, callback: (...args: any[]) => void) => void;
    invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>; 
  };
  selectFolder?: () => Promise<string>;
  getOS: () => Promise<string>;
}

declare global {
  interface Window {
    electron: ElectronApi; //  Declare globally only once
  }
}
