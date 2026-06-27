/**
 * FIX_PLAN W1.1 — production auth guardrails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { assertProductionAuthConfig, loadConfig, resolveAuthMode } from '../src/config.js';
import { buildServer } from '../src/server.js';
import type { AppConfig } from '../src/config.js';
import type { AuthOutcome } from '../src/services/auth.js';

const okS3 = {
  config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) },
  async send() { return {}; },
} as unknown as S3Client;

const okPrisma = {
  async $disconnect() {},
} as unknown as PrismaClient;

function prodConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    nodeEnv: 'production',
    maxFileSizeBytes: 1024,
    s3: { bucket: 'b', region: 'us-east-1', endpoint: undefined, forcePathStyle: false },
    retry: { maxAttempts: 1, baseDelayMs: 1 },
    sftp: { enabled: false, watchDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
    as2: { enabled: false, inboxDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
    ourIsaIds: [],
    notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
    clerk: {
      secretKey: 'sk_live_test',
      webhookSecret: 'whsec_test',
      publishableKey: 'pk_live_test',
    },
    storage: { backend: 's3', localDataDir: '/tmp' },
    alertSuppressionMinutes: 60,
    cors: { allowedOrigins: [] },
    webStatic: { dir: '' },
    ...overrides,
  };
}

test('assertProductionAuthConfig throws when Clerk secrets are missing', () => {
  assert.throws(
    () => assertProductionAuthConfig(prodConfig({ clerk: { secretKey: '', webhookSecret: '', publishableKey: '' } })),
    /Production boot refused.*CLERK_SECRET_KEY/,
  );
});

test('assertProductionAuthConfig passes when all Clerk secrets are set', () => {
  assert.doesNotThrow(() => assertProductionAuthConfig(prodConfig()));
});

test('assertProductionAuthConfig is a no-op outside production', () => {
  assert.doesNotThrow(() =>
    assertProductionAuthConfig(prodConfig({ nodeEnv: 'development', clerk: { secretKey: '', webhookSecret: '' } })),
  );
});

test('assertProductionAuthConfig is a no-op for desktop hub mode in production', () => {
  const prev = process.env.EDI_HUB_USER_DATA_DIR;
  process.env.EDI_HUB_USER_DATA_DIR = 'C:\\Users\\test\\AppData\\Roaming\\EDI Hub';
  try {
    assert.doesNotThrow(() =>
      assertProductionAuthConfig(prodConfig({ clerk: { secretKey: '', webhookSecret: '', publishableKey: '' } })),
    );
  } finally {
    if (prev) process.env.EDI_HUB_USER_DATA_DIR = prev;
    else delete process.env.EDI_HUB_USER_DATA_DIR;
  }
});

test('resolveAuthMode reports clerk vs dev-fallback', () => {
  assert.equal(resolveAuthMode(prodConfig()), 'clerk');
  assert.equal(resolveAuthMode(prodConfig({ clerk: { secretKey: '', webhookSecret: '' } })), 'dev-fallback');
});

test('loadConfig does not throw in production before Secrets Manager overlay', () => {
  const prev = { ...process.env };
  try {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.NODE_ENV = 'production';
    process.env.S3_BUCKET = 'test-bucket';
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_WEBHOOK_SECRET;
    delete process.env.VITE_CLERK_PUBLISHABLE_KEY;
    const cfg = loadConfig();
    assert.equal(cfg.nodeEnv, 'production');
    assert.equal(resolveAuthMode(cfg), 'dev-fallback');
  } finally {
    process.env = prev;
  }
});

test('production + dev-fallback returns 500 AUTH_MISCONFIGURED on authenticated routes', async () => {
  const verifyAuth = async (): Promise<AuthOutcome> => ({ kind: 'dev-fallback' });
  const app = await buildServer({
    config: prodConfig({ clerk: { secretKey: '', webhookSecret: '' } }),
    s3: okS3,
    prisma: okPrisma,
    verifyAuth,
  });

  const res = await app.inject({ method: 'GET', url: '/api/partners-config' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.code, 'AUTH_MISCONFIGURED');
  await app.close();
});

test('production desktop hub + dev-fallback does not return AUTH_MISCONFIGURED', async () => {
  const prev = process.env.EDI_HUB_USER_DATA_DIR;
  process.env.EDI_HUB_USER_DATA_DIR = 'C:\\Users\\test\\AppData\\Roaming\\EDI Hub';
  try {
    const verifyAuth = async (): Promise<AuthOutcome> => ({ kind: 'dev-fallback' });
    const app = await buildServer({
      config: prodConfig({
        clerk: { secretKey: '', webhookSecret: '' },
        storage: { backend: 'local', localDataDir: '/tmp/edi-raw' },
      }),
      s3: okS3,
      prisma: okPrisma,
      verifyAuth,
    });

    const res = await app.inject({ method: 'GET', url: '/api/partners-config' });
    assert.notEqual(res.json()?.error?.code, 'AUTH_MISCONFIGURED');
    await app.close();
  } finally {
    if (prev) process.env.EDI_HUB_USER_DATA_DIR = prev;
    else delete process.env.EDI_HUB_USER_DATA_DIR;
  }
});
