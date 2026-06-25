/**
 * D9 Sprint 1 — Help menu backup / restore actions.
 */
import { app, dialog } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyExtractedBackup,
  backupPaths,
  createBackupZip,
  defaultBackupFilename,
  extractBackupZip,
} from './backup-core.js';
import { getDesktopRuntime } from './desktop-runtime.js';

export async function exportBackupInteractive(): Promise<void> {
  const rt = getDesktopRuntime();
  const suggested = defaultBackupFilename();
  const save = await dialog.showSaveDialog({
    title: 'Export EDI Hub backup',
    defaultPath: join(app.getPath('documents'), suggested),
    filters: [{ name: 'EDI Hub Backup', extensions: ['zip'] }],
  });
  if (save.canceled || !save.filePath) return;

  try {
    await rt.stopApi();
    await rt.stopPostgres();
    const manifest = await createBackupZip({
      paths: backupPaths(rt.userDataDir),
      destZipPath: save.filePath,
      appVersion: rt.appVersion,
    });
    await rt.startPostgresStack();
    await rt.startApi();
    await dialog.showMessageBox({
      type: 'info',
      title: 'Backup complete',
      message: 'EDI Hub backup exported successfully.',
      detail: `Saved to:\n${save.filePath}\n\nCreated: ${manifest.createdAt}`,
      buttons: ['OK'],
    });
  } catch (err) {
    console.error('[edi-hub] backup export failed:', err);
    try {
      await rt.startPostgresStack();
      await rt.startApi();
    } catch (restartErr) {
      console.error('[edi-hub] failed to restart after backup error:', restartErr);
    }
    await dialog.showMessageBox({
      type: 'error',
      title: 'Backup failed',
      message: 'Could not export backup.',
      detail: err instanceof Error ? err.message : String(err),
      buttons: ['OK'],
    });
  }
}

export async function restoreBackupInteractive(): Promise<void> {
  const rt = getDesktopRuntime();
  const pick = await dialog.showOpenDialog({
    title: 'Restore EDI Hub backup',
    properties: ['openFile'],
    filters: [{ name: 'EDI Hub Backup', extensions: ['zip'] }],
  });
  if (pick.canceled || pick.filePaths.length === 0) return;
  const zipPath = pick.filePaths[0]!;

  const confirm = await dialog.showMessageBox({
    type: 'warning',
    title: 'Restore backup?',
    message: 'This will replace all current EDI Hub data.',
    detail:
      'Your database and ingested raw files will be overwritten with the ' +
      'contents of this backup. This cannot be undone unless you have another backup.',
    buttons: ['Restore', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (confirm.response !== 0) return;

  const tempDir = await mkdtemp(join(tmpdir(), 'edi-hub-restore-'));
  try {
    await rt.stopApi();
    await rt.stopPostgres();
    const manifest = await extractBackupZip(zipPath, tempDir);
    await applyExtractedBackup(tempDir, backupPaths(rt.userDataDir));
    await rt.startPostgresStack();
    await rt.startApi();
    await rt.reloadMainWindow();
    await dialog.showMessageBox({
      type: 'info',
      title: 'Restore complete',
      message: 'EDI Hub has been restored from backup.',
      detail: `Backup from ${manifest.createdAt} (app ${manifest.appVersion}).`,
      buttons: ['OK'],
    });
  } catch (err) {
    console.error('[edi-hub] restore failed:', err);
    try {
      await rt.startPostgresStack();
      await rt.startApi();
    } catch (restartErr) {
      console.error('[edi-hub] failed to restart after restore error:', restartErr);
    }
    await dialog.showMessageBox({
      type: 'error',
      title: 'Restore failed',
      message: 'Could not restore from backup.',
      detail: err instanceof Error ? err.message : String(err),
      buttons: ['OK'],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
