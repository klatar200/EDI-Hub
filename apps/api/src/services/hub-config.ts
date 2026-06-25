/**
 * Desktop track D8 Sprint 2 — hub config persisted in `<userData>/config.json`.
 *
 * The Electron main process and the API child share this file via
 * `EDI_HUB_USER_DATA_DIR`. Electron's auto-update writes `pendingWhatsNew`;
 * the first-run wizard writes setup fields. Every write merges with the
 * existing file so neither side clobbers the other.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { HubConfig } from '@edi/shared';

const CONFIG_FILE = 'config.json';

export function hubConfigPath(): string | null {
  const dir = process.env.EDI_HUB_USER_DATA_DIR?.trim();
  if (!dir) return null;
  return join(dir, CONFIG_FILE);
}

/** True when the API is running inside the desktop installer child process. */
export function isDesktopHubMode(): boolean {
  return hubConfigPath() !== null;
}

export function readHubConfig(): HubConfig {
  const path = hubConfigPath();
  if (!path || !existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as HubConfig;
  } catch {
    return {};
  }
}

/** Shallow-merge `patch` into the on-disk config and return the result. */
export function writeHubConfig(patch: HubConfig): HubConfig {
  const path = hubConfigPath();
  if (!path) {
    throw new Error('Hub config is only writable in desktop mode (EDI_HUB_USER_DATA_DIR unset).');
  }
  const next: HubConfig = { ...readHubConfig(), ...patch };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
