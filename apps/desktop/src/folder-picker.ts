/**
 * Desktop track D8 Sprint 2 — native folder picker IPC for the wizard.
 */
import { ipcMain, dialog, type BrowserWindow } from 'electron';

export function registerFolderPickerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('desktop:pick-drop-folder', async () => {
    const win = getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openDirectory', 'createDirectory'],
          title: 'Choose EDI drop folder',
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
          title: 'Choose EDI drop folder',
        });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });
}
