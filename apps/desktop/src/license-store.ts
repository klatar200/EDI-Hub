/**
 * D8 Sprint 1 — read/write `<userData>/license.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  readLicenseFileFromJson,
  serializeLicenseFile,
  type LicenseFile,
} from './license.js';

export function licenseFilePath(userDataDir: string): string {
  return join(userDataDir, 'license.json');
}

export function loadLicenseFile(userDataDir: string): LicenseFile | null {
  const path = licenseFilePath(userDataDir);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    return readLicenseFileFromJson(raw);
  } catch {
    return null;
  }
}

/** Record first launch if missing; returns the persisted file. */
export function ensureLicenseFile(userDataDir: string, now: Date): LicenseFile {
  const existing = loadLicenseFile(userDataDir);
  if (existing) return existing;
  const created: LicenseFile = { firstLaunchAt: now.toISOString() };
  saveLicenseFile(userDataDir, created);
  return created;
}

export function saveLicenseFile(userDataDir: string, file: LicenseFile): void {
  const path = licenseFilePath(userDataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeLicenseFile(file), 'utf8');
}

export function saveLicenseKey(userDataDir: string, licenseKey: string, now: Date): LicenseFile {
  const file = ensureLicenseFile(userDataDir, now);
  const next: LicenseFile = { ...file, licenseKey };
  saveLicenseFile(userDataDir, next);
  return next;
}
