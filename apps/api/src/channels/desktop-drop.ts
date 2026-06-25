/**
 * Desktop track D8 Sprint 2 — user-chosen drop folder for the installer.
 *
 * Structurally identical to the SFTP/AS2 drop-folder channels but configured
 * from `<userData>/config.json` after the first-run wizard completes.
 */
import { join } from 'node:path';
import type { IngestionDeps } from '../services/ingestion.js';
import { startDropFolderChannel } from './drop-folder.js';
import type { IngestionChannel } from './types.js';

export const DESKTOP_DROP_CHANNEL_NAME = 'desktop-drop';

export function desktopDropDirs(watchDir: string): {
  watchDir: string;
  processedDir: string;
  failedDir: string;
} {
  const parent = join(watchDir, '..');
  return {
    watchDir,
    processedDir: join(parent, 'drop-processed'),
    failedDir: join(parent, 'drop-failed'),
  };
}

export async function startDesktopDropChannel(
  deps: IngestionDeps,
  watchDir: string,
): Promise<IngestionChannel> {
  const dirs = desktopDropDirs(watchDir);
  return startDropFolderChannel(deps, {
    name: DESKTOP_DROP_CHANNEL_NAME,
    source: 'sftp',
    watchDir: dirs.watchDir,
    processedDir: dirs.processedDir,
    failedDir: dirs.failedDir,
    stabilityThresholdMs: 500,
  });
}
