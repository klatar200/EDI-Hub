/**
 * Desktop clerk-runtime.json loader tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadClerkRuntimeEnv } from '../src/clerk-runtime.js';

test('loadClerkRuntimeEnv returns empty when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edi-clerk-'));
  assert.deepEqual(loadClerkRuntimeEnv(dir), {});
});

test('loadClerkRuntimeEnv maps bundled keys to API env names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edi-clerk-'));
  writeFileSync(
    join(dir, 'clerk-runtime.json'),
    JSON.stringify({
      publishableKey: 'pk_live_test',
      secretKey: 'sk_live_test',
      webhookSecret: 'whsec_test',
      authorizedParties: 'http://localhost:3000',
    }),
    'utf8',
  );
  assert.deepEqual(loadClerkRuntimeEnv(dir), {
    VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_test',
    CLERK_SECRET_KEY: 'sk_live_test',
    CLERK_WEBHOOK_SECRET: 'whsec_test',
    CLERK_AUTHORIZED_PARTIES: 'http://localhost:3000',
  });
});
