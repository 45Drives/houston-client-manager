/**
 * Native dialogs must be parented to a window.
 *
 * On Linux the file picker and message boxes are served by xdg-desktop-portal. With no
 * parent the portal gets no transient-for hint, so KWin/GNOME treat the dialog as an
 * unrelated top-level window, apply focus-stealing prevention, and stack it behind the
 * app where it is only reachable from the taskbar. Parenting also gives proper modality
 * on Windows and an attached sheet on macOS.
 */

import { BrowserWindow, dialog } from 'electron';

/** The app runs a single window; prefer the focused one in case that ever changes. */
export function getDialogParent(): BrowserWindow | null {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  return win && !win.isDestroyed() ? win : null;
}

/** The portal anchors to the active window, so raise the app before opening. */
function raise(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export async function showOpenDialogOwnedByMain(
  options: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  const parent = getDialogParent();
  if (!parent) return dialog.showOpenDialog(options);

  raise(parent);
  const result = await dialog.showOpenDialog(parent, options);
  if (!parent.isDestroyed()) parent.focus();
  return result;
}

export async function showMessageBoxOwnedByMain(
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  const parent = getDialogParent();
  if (!parent) return dialog.showMessageBox(options);

  raise(parent);
  const result = await dialog.showMessageBox(parent, options);
  if (!parent.isDestroyed()) parent.focus();
  return result;
}
