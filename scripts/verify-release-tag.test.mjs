import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, 'verify-release-tag.mjs');
const pkgPath = resolve(here, '..', 'apps', 'desktop', 'package.json');
const pkgVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version;

function runVerify(args, env = {}) {
  return execFileSync('node', [script, ...args], {
    cwd: resolve(here, '..'),
    env: { ...process.env, SKIP_MAIN_HEAD_CHECK: 'true', ...env },
    encoding: 'utf8',
  });
}

function runVerifyFail(args, env = {}) {
  assert.throws(
    () =>
      execFileSync('node', [script, ...args], {
        cwd: resolve(here, '..'),
        env: { ...process.env, SKIP_MAIN_HEAD_CHECK: 'true', ...env },
        encoding: 'utf8',
      }),
    (error) => error.status === 1,
  );
}

test('accepts tag matching package.json version', () => {
  const out = runVerify([`v${pkgVersion}`]);
  assert.match(out, /OK — tag/);
});

test('accepts tag from GITHUB_REF_NAME env', () => {
  const out = runVerify([], { GITHUB_REF_NAME: `v${pkgVersion}` });
  assert.match(out, /OK — tag/);
});

test('rejects tag that does not match package.json', () => {
  runVerifyFail(['v0.0.0-does-not-match']);
});

test('rejects tag without v prefix pattern', () => {
  runVerifyFail(['0.0.1-alpha']);
});

test('rejects when no tag is provided', () => {
  runVerifyFail([]);
});
