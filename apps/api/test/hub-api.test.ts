/**
 * Phase 3 read-API tests: /partners, /raw-files/:id/content, /search, and the
 * /transactions filter join. In-memory S3/Prisma fakes; no real infra.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { buildServer } from '../src/server.js';
import type { AppConfig } from '../src/config.js';
import { PILOT_TENANT_ID } from '@edi/db';

const config = {
  port: 0, nodeEnv: 'test', maxFileSizeBytes: 1024 * 1024,
  s3: { bucket: 'b', region: 'us-east-1', endpoint: 'http://localhost:9000', forcePathStyle: true },
  retry: { maxAttempts: 1, baseDelayMs: 1 },
  sftp: { enabled: false, watchDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
  as2: { enabled: false, inboxDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
  ourIsaIds: [],
  notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
  clerk: { secretKey: '', webhookSecret: '' },
  storage: { backend: 's3', localDataDir: '/tmp/edi-test' },
  alertSuppressionMinutes: 60,
  cors: { allowedOrigins: [] },
  webStatic: { dir: "" },
} as AppConfig;

const RAW_BYTES = Buffer.from('ISA*00*...~GS*PO*ACME*GLOBEX*...~ST*850*0001~');

function fakeS3(): S3Client {
  return {
    config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) },
    async send(command: { constructor: { name: string } }) {
      if (command.constructor?.name === 'GetObjectCommand') {
        return { Body: (async function* () { yield RAW_BYTES; })() };
      }
      return {};
    },
  } as unknown as S3Client;
}

const txn = {
  id: 'txn-1', functionalGroupId: 'g1', transactionSetId: '850', controlNumber: '0001',
  declaredSegmentCount: 5, segmentCount: 5, poNumber: 'PO-12345', invoiceNumber: null, purpose: '00',
  direction: 'inbound' as const,
  functionalGroup: { interchange: { senderId: 'ACME', receiverId: 'GLOBEX', rawFile: { status: 'PARSED', ingestedAt: new Date('2026-06-17T12:00:00Z'), source: 'upload' } } },
};
const rawFileRow = { id: 'raw-1', s3Key: 'raw/x.edi', fileHash: 'h', isaControlNumber: '000000900', source: 'upload', status: 'PARSED', errorMessage: null, ingestedAt: new Date('2026-06-17T12:00:00Z') };

function fakePrisma(): PrismaClient {
  return {
    rawFile: {
      async findUnique({ where }: { where: Record<string, unknown> }) {
        const w = where as {
          id?: string;
          isaControlNumber?: string;
          tenantId_isaControlNumber?: { tenantId: string; isaControlNumber: string };
        };
        if (w.tenantId_isaControlNumber) {
          const { tenantId, isaControlNumber } = w.tenantId_isaControlNumber;
          if (tenantId === PILOT_TENANT_ID && isaControlNumber === rawFileRow.isaControlNumber) {
            return rawFileRow;
          }
          return null;
        }
        if (w.id === rawFileRow.id) return rawFileRow;
        if (w.isaControlNumber === rawFileRow.isaControlNumber) return rawFileRow;
        return null;
      },
      async findMany() { return [rawFileRow]; },
      async count() { return 1; },
    },
    interchange: {
      async findMany() { return [{ senderId: 'ACME', receiverId: 'GLOBEX' }, { senderId: 'ACME', receiverId: 'OTHER' }]; },
    },
    transaction: {
      async findMany({ where }: { where?: { poNumber?: string; invoiceNumber?: string; transactionSetId?: string; direction?: string; functionalGroup?: { interchange?: { OR?: Array<{ senderId?: string; receiverId?: string }> } } } } = {}) {
        const w = where ?? {};
        if (w.poNumber && w.poNumber !== txn.poNumber) return [];
        if (w.invoiceNumber) return [];
        if (w.transactionSetId && w.transactionSetId !== txn.transactionSetId) return [];
        if (w.direction && w.direction !== txn.direction) return [];
        const partner = w.functionalGroup?.interchange?.OR?.[0]?.senderId;
        if (partner && partner !== 'ACME') return [];
        return [txn];
      },
    },
    alert: {
      async findMany() { return []; },
    },
    // Phase 9 Sprint 1.4 — lifecycle route looks up tenant.ourIsaIds.
    tenant: {
      async findUnique() { return { ourIsaIds: [], settings: {} }; },
    },
  } as unknown as PrismaClient;
}

test('GET /partners returns distinct sorted partner ids', async () => {
  const app = await buildServer({ config, s3: fakeS3(), prisma: fakePrisma() });
  const res = await app.inject({ method: 'GET', url: '/api/partners' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().partners, ['ACME', 'GLOBEX', 'OTHER']);
  await app.close();
});

test('GET /transactions filters by partner and set, returning joined summary', async () => {
  const app = await buildServer({ config, s3: fakeS3(), prisma: fakePrisma() });
  const res = await app.inject({ method: 'GET', url: '/api/transactions?set=850&partner=ACME' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.count, 1);
  assert.equal(body.items[0].senderId, 'ACME');
  assert.equal(body.items[0].status, 'PARSED');
  assert.equal(body.items[0].ingestedAt, '2026-06-17T12:00:00.000Z');
  assert.equal(body.items[0].direction, 'inbound');

  const byDir = await app.inject({ method: 'GET', url: '/api/transactions?direction=inbound' });
  assert.equal(byDir.json().count, 1);
  const missDir = await app.inject({ method: 'GET', url: '/api/transactions?direction=outbound' });
  assert.equal(missDir.json().count, 0);

  const miss = await app.inject({ method: 'GET', url: '/api/transactions?partner=NOBODY' });
  assert.equal(miss.json().count, 0);
  await app.close();
});

test('GET /raw-files/:id/content streams the stored bytes', async () => {
  const app = await buildServer({ config, s3: fakeS3(), prisma: fakePrisma() });
  const res = await app.inject({ method: 'GET', url: '/api/raw-files/raw-1/content' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/edi-x12');
  assert.equal(res.rawPayload.toString(), RAW_BYTES.toString());

  const missing = await app.inject({ method: 'GET', url: '/api/raw-files/nope/content' });
  assert.equal(missing.statusCode, 404);
  await app.close();
});

test('GET /search resolves PO number to a transaction and ISA to a raw file', async () => {
  const app = await buildServer({ config, s3: fakeS3(), prisma: fakePrisma() });
  const byPo = await app.inject({ method: 'GET', url: '/api/search?q=PO-12345' });
  assert.equal(byPo.statusCode, 200);
  assert.equal(byPo.json().transactions.length, 1);
  assert.equal(byPo.json().transactions[0].poNumber, 'PO-12345');

  const byIsa = await app.inject({ method: 'GET', url: '/api/search?q=000000900' });
  assert.equal(byIsa.json().rawFiles.length, 1);
  assert.equal(byIsa.json().rawFiles[0].isaControlNumber, '000000900');
  await app.close();
});
