/** Desktop Electron bridge exposed via preload contextBridge. */
export interface DesktopBridge {
  pickDropFolder(): Promise<string | null>;
}

declare global {
  interface Window {
    runtime?: { mode: 'desktop'; version: string; platform: string };
    desktop?: DesktopBridge;
  }
}

export {};
