/**
 * Desktop track D4 Sprint 2 + D8 Sprint 2 — preload script.
 *
 * Exposes:
 *   - `window.runtime` — desktop mode marker for optional UI affordances.
 *   - `window.desktop.pickDropFolder()` — native folder picker for the wizard.
 */
import { contextBridge, ipcRenderer } from 'electron';

const runtime = {
  mode: 'desktop' as const,
  version: process.env.EDI_DESKTOP_VERSION ?? '0.0.0',
  platform: process.platform,
};

const desktop = {
  pickDropFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('desktop:pick-drop-folder') as Promise<string | null>,
};

contextBridge.exposeInMainWorld('runtime', runtime);
contextBridge.exposeInMainWorld('desktop', desktop);
