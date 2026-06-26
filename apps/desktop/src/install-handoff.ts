/**
 * Tracks the gap between quitAndInstall and post-update relaunch so the
 * update log records how long NSIS spent replacing files on disk.
 */
import { app } from 'electron';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logUpdate } from './update-logger.js';

export interface InstallHandoff {
  startedAt: string;
  targetVersion: string;
}

/** @internal testable without Electron */
export function parseInstallHandoff(raw: string): InstallHandoff | null {
  try {
    const parsed = JSON.parse(raw) as InstallHandoff;
    if (typeof parsed.startedAt !== 'string' || typeof parsed.targetVersion !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** @internal testable without Electron */
export function computeInstallGapMs(startedAt: string, nowMs = Date.now()): number {
  return nowMs - new Date(startedAt).getTime();
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
    const handoff = parseInstallHandoff(readFileSync(path, 'utf8'));
    if (!handoff) return;
    const gapMs = computeInstallGapMs(handoff.startedAt);
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
