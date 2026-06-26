/**
 * Desktop operator script env detection.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  applyDesktopScriptEnv,
  isDesktopScriptTarget,
} from '../src/scripts/desktop-script-env.js';

test('isDesktopScriptTarget detects --desktop flag', () => {
  assert.equal(isDesktopScriptTarget(['node', 'script', '--desktop']), true);
  assert.equal(isDesktopScriptTarget(['node', 'script']), false);
});

test('applyDesktopScriptEnv forces local storage for desktop', () => {
  const prev = {
    DATABASE_URL: process.env.DATABASE_URL,
    STORAGE_BACKEND: process.env.STORAGE_BACKEND,
    LOCAL_DATA_DIR: process.env.LOCAL_DATA_DIR,
    EDI_HUB_USER_DATA_DIR: process.env.EDI_HUB_USER_DATA_DIR,
    APPDATA: process.env.APPDATA,
    S3_BUCKET: process.env.S3_BUCKET,
  };
  try {
    delete process.env.DATABASE_URL;
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    process.env.STORAGE_BACKEND = 's3';
    process.env.S3_BUCKET = 'edi-raw-files';

    const applied = applyDesktopScriptEnv(['node', 'script', '--desktop']);
    assert.equal(applied, true);
    assert.equal(process.env.STORAGE_BACKEND, 'local');
    assert.equal(
      process.env.LOCAL_DATA_DIR,
      join('C:\\Users\\test\\AppData\\Roaming', 'EDI Hub', 'raw'),
    );
    assert.match(process.env.DATABASE_URL ?? '', /5433/);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
      else (process.env as Record<string, string>)[k] = v;
    }
  }
});

test('applyDesktopScriptEnv is a no-op without desktop signals', () => {
  const prev = {
    DATABASE_URL: process.env.DATABASE_URL,
    STORAGE_BACKEND: process.env.STORAGE_BACKEND,
    EDI_HUB_USER_DATA_DIR: process.env.EDI_HUB_USER_DATA_DIR,
    EDI_HUB_DESKTOP: process.env.EDI_HUB_DESKTOP,
  };
  try {
    delete process.env.DATABASE_URL;
    delete process.env.EDI_HUB_USER_DATA_DIR;
    delete process.env.EDI_HUB_DESKTOP;
    process.env.STORAGE_BACKEND = 's3';

    const applied = applyDesktopScriptEnv(['node', 'script']);
    assert.equal(applied, false);
    assert.equal(process.env.STORAGE_BACKEND, 's3');
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
      else (process.env as Record<string, string>)[k] = v;
    }
  }
});
