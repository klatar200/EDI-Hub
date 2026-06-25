/**
 * Desktop track D4 Sprint 3 — native application menu.
 *
 * Installs the Electron app's top-level menu (File / Edit / Help).
 * Standard `role:` items handle the Edit submenu so OS-level shortcuts
 * (Cmd/Ctrl-C, Cmd/Ctrl-V, etc.) work without any handler glue.
 *
 * "Check for Updates" is a stub — wired up in D7 when electron-updater
 * is configured. Menu items are intentionally NOT removed when disabled
 * so the user sees the feature exists.
 */
import { app, dialog, Menu, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

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
          label: 'Open Logs Folder',
          click: () => {
            // `app.getPath('logs')` returns a platform-specific path
            // (Windows: %APPDATA%\<productName>\logs). The folder may
            // not exist yet if nothing's logged this session — fall
            // back to userData so the user always lands somewhere
            // useful.
            const logsDir = app.getPath('logs');
            shell.openPath(logsDir).then((errMsg) => {
              if (errMsg) {
                void shell.openPath(app.getPath('userData'));
              }
            });
          },
        },
        { type: 'separator' },
        {
          label: 'Check for Updates',
          enabled: false, // D7 wires this to electron-updater.
          click: () => {
            // Intentionally empty — gated by enabled:false until D7.
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
