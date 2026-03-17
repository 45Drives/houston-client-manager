import type { BrowserWindow } from 'electron';
import type { BackUpManager } from '../backup/types';
import type { Logger } from 'winston';

export interface IPCHandlerContext {
  getBackUpManager: () => BackUpManager | null;
  notify: (message: string) => void;
  jsonLogger: Logger;
  mainWindow: BrowserWindow;
}
