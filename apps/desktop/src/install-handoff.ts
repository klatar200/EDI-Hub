/**
 * Tracks the gap between quitAndInstall and post-update relaunch so the
 * update log records how long NSIS spent replacing files on disk.
 */
import { app } from 'electron';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logUpdate } from './update-logger.js';

interface InstallHandoff {
  startedAt: string;
  targetVersion: string;
}

function handoffPath(): string {
  return join(app.getPath('userData'), 'install-handoff.json');
}

export function writeInstallHandoff(targetVersion: string): void {
  const payload: InstallHandoff = {
    startedAt: new Date().toISOString(),
    targetVersion,
  };
  writeFileSync(handoffPath(), JSON.stringify(payload, null, 2), 'utf8');
  logUpdate('install_handoff', { ...payload });
}

export function consumeInstallHandoff(): void {
  const path = handoffPath();
  if (!existsSync(path)) return;
  try {
    const handoff = JSON.parse(readFileSync(path, 'utf8')) as InstallHandoff;
    const gapMs = Date.now() - new Date(handoff.startedAt).getTime();
    logUpdate('install_complete', {
      targetVersion: handoff.targetVersion,
      appVersion: app.getVersion(),
      gapMs,
    });
    unlinkSync(path);
  } catch {
    // Non-fatal — don't block boot on a corrupt handoff file.
  }
}
