/**
 * Desktop track D4 Sprint 3 — native application menu.
 *
 * PS-12 F40/F62 — Help menu includes What's New + Copy LAN URL.
 */
import { app, dialog, Menu, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { manualCheckForUpdates } from './auto-update.js';
import { showEnterLicenseKeyMenu } from './license-window.js';
import { updateLogFilePath } from './update-logger.js';

/** Keep in sync with packages/shared/src/help-links.ts */
const RELEASES_URL = 'https://github.com/klatar200/EDI-Hub/releases';

export function buildApplicationMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: 'File',
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: "What's New",
          click: () => {
            void shell.openExternal(RELEASES_URL);
          },
        },
        {
          label: 'Copy LAN URL',
          click: () => {
            void (async () => {
              try {
                const port = Number(process.env.PORT ?? 3000);
                const { buildHealthServerInfo } = await import('@edi/shared/server-address');
                const { preferredLanOrigin } = await import('@edi/shared');
                const url = preferredLanOrigin(buildHealthServerInfo(port).redirectOrigins);
                const { clipboard } = await import('electron');
                clipboard.writeText(url);
                await dialog.showMessageBox({
                  type: 'info',
                  message: 'LAN URL copied',
                  detail: url,
                  buttons: ['OK'],
                });
              } catch {
                await dialog.showMessageBox({
                  type: 'error',
                  message: 'Could not read server URL',
                  buttons: ['OK'],
                });
              }
            })();
          },
        },
        { type: 'separator' },
        {
          label: 'About EDI Hub',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'About EDI Hub',
              message: 'EDI Hub',
              detail:
                `Version ${app.getVersion()}\n` +
                'EDI observability platform — monitor inbound and outbound transactions, ' +
                'troubleshoot rejections, get alerts when acks go missing.',
              buttons: ['OK'],
            });
          },
        },
        {
          label: 'Open Data Folder',
          click: () => {
            void shell.openPath(app.getPath('userData'));
          },
        },
        {
          label: 'Open Logs Folder',
          click: () => {
            const logsDir = app.getPath('logs');
            if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
            void shell.openPath(logsDir);
          },
        },
        {
          label: 'Open Update Log',
          click: () => {
            const logsDir = app.getPath('logs');
            if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
            void shell.openPath(updateLogFilePath());
          },
        },
        { type: 'separator' },
        {
          label: 'Export Backup…',
          click: () => {
            void import('./backup-actions.js').then((m) => m.exportBackupInteractive());
          },
        },
        {
          label: 'Restore from Backup…',
          click: () => {
            void import('./backup-actions.js').then((m) => m.restoreBackupInteractive());
          },
        },
        { type: 'separator' },
        {
          label: 'Enter License Key',
          click: () => {
            void showEnterLicenseKeyMenu(app.getPath('userData'));
          },
        },
        { type: 'separator' },
        {
          label: 'Check for Updates',
          click: () => {
            void manualCheckForUpdates();
          },
        },
      ],
    },
  ];
}

export function installApplicationMenu(): void {
  const menu = Menu.buildFromTemplate(buildApplicationMenuTemplate());
  Menu.setApplicationMenu(menu);
}
