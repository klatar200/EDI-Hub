import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { computeInstallGapMs, parseInstallHandoff } from '../src/install-handoff.js';

test('parseInstallHandoff accepts valid JSON', () => {
  const handoff = parseInstallHandoff(
    JSON.stringify({ startedAt: '2026-06-26T19:41:36.201Z', targetVersion: '0.0.23-alpha' }),
  );
  assert.equal(handoff?.targetVersion, '0.0.23-alpha');
});

test('parseInstallHandoff rejects corrupt JSON', () => {
  assert.equal(parseInstallHandoff('{not json'), null);
});

test('computeInstallGapMs measures elapsed time', () => {
  const startedAt = '2026-06-26T19:41:36.201Z';
  const gap = computeInstallGapMs(startedAt, new Date('2026-06-26T19:46:58.354Z').getTime());
  assert.equal(gap, 322_153);
});

test('compiled auto-update uses non-silent quitAndInstall', () => {
  const distPath = join(import.meta.dirname, '..', 'dist', 'auto-update.js');
  assert.ok(existsSync(distPath), `missing ${distPath} — run tsc --build first`);
  const source = readFileSync(distPath, 'utf8');
  assert.match(source, /quitAndInstall\s*\(\s*false\s*,\s*true\s*\)/);
  assert.doesNotMatch(source, /quitAndInstall\s*\(\s*true\s*,/);
  assert.match(source, /isSilent:\s*false/);
  assert.match(source, /writeInstallHandoff/);
});
