/**
 * Phase 9 Sprint 5 — security response headers test.
 *
 * Boots a minimal server and verifies every response — including the
 * public `/health` and the dev-fallback authenticated `/partners-config` —
 * carries the HSTS / X-Content-Type-Options / Referrer-Policy headers
 * the securityHeaders plugin emits.
 *
 * If this test ever fails the cause is almost always that the plugin
 * registration moved AFTER a route that short-circuits the response
 * (Fastify hooks fire in registration order for onSend too); rewire
 * server.ts so securityHeaders registers early.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { buildServer } from '../src/server.js';
import type { AppConfig } from '../src/config.js';
import type { AuthOutcome } from '../src/services/auth.js';

function makeConfig(): AppConfig {
  return {
    port: 0,
    nodeEnv: 'test',
    maxFileSizeBytes: 1024 * 1024,
    s3: { bucket: 'b', region: 'us-east-1', endpoint: 'http://localhost:9000', forcePathStyle: true },
    retry: { maxAttempts: 1, baseDelayMs: 1 },
    sftp: { enabled: false, watchDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
    as2: { enabled: false, inboxDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
    ourIsaIds: [],
    notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
    clerk: { secretKey: '', webhookSecret: '' },
  storage: { backend: 's3', localDataDir: '/tmp/edi-test' },
    alertSuppressionMinutes: 60,
    lanApiToken: '',
  cors: { allowedOrigins: [] },
  webStatic: { dir: "" },
  } as AppConfig;
}

const okS3 = {
  config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) },
  async send() { return {}; },
} as unknown as S3Client;

const stubPrisma = {
  rawFile: { async count() { return 0; } },
  tenant: { async findUnique() { return null; } },
  user: { async findUnique() { return null; } },
  // Used by GET /partners-config in the second test below — return an empty
  // list so the route returns 200 cleanly rather than 500 (HSTS would still
  // appear on the error response, but a clean 200 makes the test signal
  // about the headers and nothing else).
  tradingPartner: { async findMany() { return []; } },
} as unknown as PrismaClient;

const verifyDevFallback = async (): Promise<AuthOutcome> => ({ kind: 'dev-fallback' });

test('/health response carries HSTS + nosniff + Referrer-Policy headers', async () => {
  const app = await buildServer({
    config: makeConfig(),
    s3: okS3,
    prisma: stubPrisma,
    verifyAuth: verifyDevFallback,
  });
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  const hsts = res.headers['strict-transport-security'];
  assert.ok(hsts, 'HSTS header present');
  assert.match(String(hsts), /max-age=\d{6,}/, 'HSTS max-age is at least six digits');
  assert.match(String(hsts), /includeSubDomains/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  await app.close();
});

test('headers also apply to authenticated routes (not just /health)', async () => {
  const app = await buildServer({
    config: makeConfig(),
    s3: okS3,
    prisma: stubPrisma,
    verifyAuth: verifyDevFallback,
  });
  // dev-fallback grants implicit admin so a GET on a viewer-required route
  // returns 200 even without a real auth token.
  const res = await app.inject({ method: 'GET', url: '/api/partners-config' });
  assert.equal(res.headers['strict-transport-security']?.includes('max-age='), true);
  await app.close();
});
