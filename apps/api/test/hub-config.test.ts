/**
 * Desktop track D8 Sprint 2 — hub config file I/O tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  hubConfigPath,
  isDesktopHubMode,
  readHubConfig,
  writeHubConfig,
} from '../src/services/hub-config.js';

test('hub config is disabled without EDI_HUB_USER_DATA_DIR', () => {
  const prev = process.env.EDI_HUB_USER_DATA_DIR;
  delete process.env.EDI_HUB_USER_DATA_DIR;
  assert.equal(isDesktopHubMode(), false);
  assert.equal(hubConfigPath(), null);
  assert.deepEqual(readHubConfig(), {});
  if (prev) process.env.EDI_HUB_USER_DATA_DIR = prev;
});

test('writeHubConfig merges fields and preserves pendingWhatsNew', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edi-hubcfg-'));
  const prev = process.env.EDI_HUB_USER_DATA_DIR;
  process.env.EDI_HUB_USER_DATA_DIR = dir;
  try {
    writeHubConfig({ pendingWhatsNew: '0.0.9-alpha', dropFolderPath: 'C:\\EDI\\in' });
    writeHubConfig({ firstRunComplete: true, telemetryEnabled: false });

    const raw = await readFile(join(dir, 'config.json'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed.pendingWhatsNew, '0.0.9-alpha');
    assert.equal(parsed.dropFolderPath, 'C:\\EDI\\in');
    assert.equal(parsed.firstRunComplete, true);
    assert.equal(parsed.telemetryEnabled, false);
  } finally {
    if (prev) process.env.EDI_HUB_USER_DATA_DIR = prev;
    else delete process.env.EDI_HUB_USER_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});
