/**
 * Desktop track D4 Sprint 3 — native application menu.
 *
 * Installs the Electron app's top-level menu (File / Edit / Help).
 * Standard `role:` items handle the Edit submenu so OS-level shortcuts
 * (Cmd/Ctrl-C, Cmd/Ctrl-V, etc.) work without any handler glue.
 *
 * "Check for Updates" calls into `auto-update.ts` which uses
 * electron-updater to poll the GitHub Releases feed. The same machinery
 * runs silently in the background at startup; the menu item just
 * surfaces every state through a dialog so a manual click always
 * produces visible feedback.
 */
import { app, dialog, Menu, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { manualCheckForUpdates } from './auto-update.js';
import { showEnterLicenseKeyMenu } from './license-window.js';

export function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
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
          label: 'About EDI Hub',
          click: () => {
            // showMessageBox returns a promise; we don't await it because
            // the menu click handler intentionally fires-and-forgets.
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
            // Manual trigger — surfaces every state through a dialog
            // (no update / downloading / error). The background
            // checkForUpdates call in main.ts is the silent path.
            void manualCheckForUpdates();
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
