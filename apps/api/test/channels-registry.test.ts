/**
 * SEC-H3 — passive channel guard in production multi-tenant mode.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passiveChannelsAllowed } from '../src/channels/registry.js';
import type { AppConfig } from '../src/config.js';

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 3000,
    nodeEnv: 'development',
    maxFileSizeBytes: 1024,
    s3: { bucket: 'b', region: 'us-east-1', endpoint: undefined, forcePathStyle: false },
    storage: { backend: 's3', localDataDir: '/tmp' },
    retry: { maxAttempts: 1, baseDelayMs: 1 },
    sftp: { enabled: false, watchDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
    as2: { enabled: false, inboxDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
    ourIsaIds: [],
    notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
    clerk: { secretKey: '', webhookSecret: '' },
    cors: { allowedOrigins: [] },
    webStatic: { dir: '' },
    alertSuppressionMinutes: 60,
    lanApiToken: '',
    ...overrides,
  };
}

test('passiveChannelsAllowed permits channels in development', () => {
  assert.equal(passiveChannelsAllowed(baseConfig()), true);
});

test('passiveChannelsAllowed blocks production SaaS with Clerk configured', () => {
  assert.equal(
    passiveChannelsAllowed(baseConfig({
      nodeEnv: 'production',
      clerk: { secretKey: 'sk_test', webhookSecret: 'whsec' },
    })),
    false,
  );
});

test('passiveChannelsAllowed permits production desktop hub', () => {
  const prev = process.env.EDI_HUB_USER_DATA_DIR;
  process.env.EDI_HUB_USER_DATA_DIR = '/tmp/edi-hub-test';
  try {
    assert.equal(
      passiveChannelsAllowed(baseConfig({
        nodeEnv: 'production',
        clerk: { secretKey: 'sk_test', webhookSecret: 'whsec' },
      })),
      true,
    );
  } finally {
    if (prev) process.env.EDI_HUB_USER_DATA_DIR = prev;
    else delete process.env.EDI_HUB_USER_DATA_DIR;
  }
});
