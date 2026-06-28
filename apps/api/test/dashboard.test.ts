/**
 * PS-3 — dashboard API tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import type { S3Client } from '@aws-sdk/client-s3';
import { buildServer } from '../src/server.js';
import type { AppConfig } from '../src/config.js';
import { getDashboard } from '../src/services/dashboard.js';

const config = {
  port: 0, nodeEnv: 'test', maxFileSizeBytes: 1024 * 1024,
  s3: { bucket: 'b', region: 'us-east-1', endpoint: 'http://localhost:9000', forcePathStyle: true },
  retry: { maxAttempts: 1, baseDelayMs: 1 },
  sftp: { enabled: false, watchDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
  as2: { enabled: false, inboxDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
  ourIsaIds: ['US'],
  notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
  clerk: { secretKey: '', webhookSecret: '' },
  storage: { backend: 's3', localDataDir: '/tmp/edi-test' },
  alertSuppressionMinutes: 60,
    lanApiToken: '',
  cors: { allowedOrigins: [] },
  webStatic: { dir: '' },
} as AppConfig;

const fakeS3 = { config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) }, async send() { return {}; } } as unknown as S3Client;

const now = new Date('2026-06-20T12:00:00Z');
const recentIngest = new Date('2026-06-20T11:00:00Z');

function fakePrisma(): PrismaClient {
  return {
    tradingPartner: {
      async findMany() {
        return [{
          id: 'p-1', displayName: 'Acme', isaSenderIds: ['ACME'], isaReceiverIds: ['US'],
          status: 'active',
        }];
      },
    },
    rawFile: {
      async findFirst({ orderBy }: { orderBy?: { ingestedAt: string } }) {
        if (orderBy?.ingestedAt === 'desc') return { ingestedAt: recentIngest };
        return { ingestedAt: recentIngest };
      },
      async findMany() {
        return [{
          id: 'rf-1',
          status: 'PARSE_ERROR',
          errorMessage: 'bad segment',
          ingestedAt: recentIngest,
          isaControlNumber: '000000001',
        }];
      },
      async groupBy() {
        return [
          { status: 'PARSED', _count: { _all: 10 } },
          { status: 'PARSE_ERROR', _count: { _all: 2 } },
        ];
      },
    },
    alert: {
      async findMany() {
        return [
          { severity: 'warning', partnerId: 'p-1', type: 'MISSING_ACK' },
          { severity: 'critical', partnerId: null, type: 'STALE_TRAFFIC' },
        ];
      },
    },
    transaction: {
      async findMany() { return []; },
      async findFirst() { return null; },
    },
    tenant: { async findUnique() { return { ourIsaIds: ['US'] }; } },
  } as unknown as PrismaClient;
}

test('getDashboard returns traffic, alerts, ingest health shape', async () => {
  const d = await getDashboard(fakePrisma(), { ourIsaIds: ['US'], now });
  assert.equal(typeof d.openAlerts.total, 'number');
  assert.equal(d.openAlerts.total, 2);
  assert.equal(d.ingestHealth.parsed, 10);
  assert.equal(d.ingestHealth.parseError, 2);
  assert.equal(d.trafficSilence.isGloballyStale, false);
  assert.ok(Array.isArray(d.partnerHealth));
  assert.equal(d.partnerHealth[0]?.missingAckCount, 1);
  assert.equal(d.recentFailures.length, 1);
});

test('GET /api/dashboard returns 200 with viewer access', async () => {
  const app = await buildServer({ config, s3: fakeS3, prisma: fakePrisma() });
  const res = await app.inject({ method: 'GET', url: '/api/dashboard?ingestWindow=7d' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { openAlerts: { total: number }; ingestHealth: { window: string } };
  assert.equal(body.ingestHealth.window, '7d');
  assert.equal(typeof body.openAlerts.total, 'number');
  await app.close();
});

test('GET /api/dashboard rejects invalid ingestWindow', async () => {
  const app = await buildServer({ config, s3: fakeS3, prisma: fakePrisma() });
  const res = await app.inject({ method: 'GET', url: '/api/dashboard?ingestWindow=bad' });
  assert.equal(res.statusCode, 400);
  await app.close();
});
