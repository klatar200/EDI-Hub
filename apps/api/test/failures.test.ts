/**
 * Failure-mode coverage (Sprint 3, task 3.2) + /health.
 *
 * Confirms each defined failure path behaves as specified, with in-memory
 * S3/Prisma fakes so it runs in CI without Postgres or MinIO.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { buildServer } from '../src/server.js';
import type { AppConfig } from '../src/config.js';
import type { ChannelHealth } from '../src/channels/types.js';

const testConfig: AppConfig = {
  port: 0,
  nodeEnv: 'test',
  maxFileSizeBytes: 25 * 1024 * 1024,
  s3: { bucket: 'test-bucket', region: 'us-east-1', endpoint: 'http://localhost:9000', forcePathStyle: true },
  retry: { maxAttempts: 2, baseDelayMs: 1 },
  sftp: { enabled: false, watchDir: './.sftp/incoming', processedDir: './.sftp/processed', failedDir: './.sftp/failed', stabilityThresholdMs: 50 },
  as2: { enabled: false, inboxDir: './.as2/inbox', processedDir: './.as2/processed', failedDir: './.as2/failed', stabilityThresholdMs: 50 },
  ourIsaIds: [],
  notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
  clerk: { secretKey: '', webhookSecret: '' },
  storage: { backend: 's3', localDataDir: '/tmp/edi-test' },
  alertSuppressionMinutes: 60,
  cors: { allowedOrigins: [] },
  webStatic: { dir: "" },
};

const toBuf = (b: unknown): Buffer => (Buffer.isBuffer(b) ? b : Buffer.from(b as Uint8Array));

function validInterchange(isa13 = '000000321'): Buffer {
  const e = '*';
  const isa = [
    'ISA', '00', ' '.repeat(10), '00', ' '.repeat(10), 'ZZ', 'SENDER'.padEnd(15),
    'ZZ', 'RECEIVER'.padEnd(15), '260101', '1200', 'U', '00401', isa13, '0', 'P',
  ].join(e) + e + ':' + '~';
  return Buffer.from(isa + 'GS*PO*SENDER*RECEIVER*20260101*1200*1*X*004010~ST*850*0001~SE*2*0001~');
}

function okS3(objects: Map<string, Buffer>): S3Client {
  return {
    config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) },
    async send(command: { constructor: { name: string }; input?: Record<string, unknown> }) {
      const name = command.constructor?.name;
      const input = command.input ?? {};
      if (name === 'HeadBucketCommand') return {};
      if (name === 'PutObjectCommand' || name === 'UploadPartCommand') { objects.set(String(input.Key), toBuf(input.Body)); return { ETag: '"ok"' }; }
      if (name === 'CreateMultipartUploadCommand') return { UploadId: 'u' };
      return {};
    },
  } as unknown as S3Client;
}

function okPrisma(): PrismaClient {
  const rows = new Map<string, { id: string; status: string; isaControlNumber: string | null }>();
  const byIsa = new Map<string, string>();
  return {
    rawFile: {
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: String(data.id), ...(data as object) } as { id: string; status: string; isaControlNumber: string | null };
        rows.set(row.id, row);
        if (row.isaControlNumber) {
          const tenantId = String((data as { tenantId?: string }).tenantId ?? '');
          byIsa.set(`${tenantId}:${row.isaControlNumber}`, row.id);
        }
        return row;
      },
      async findUnique({ where }: { where: Record<string, unknown> }) {
        const w = where as {
          id?: string;
          isaControlNumber?: string;
          tenantId_isaControlNumber?: { tenantId: string; isaControlNumber: string };
        };
        if (w.tenantId_isaControlNumber) {
          const { tenantId, isaControlNumber } = w.tenantId_isaControlNumber;
          const id = byIsa.get(`${tenantId}:${isaControlNumber}`);
          return id ? rows.get(id)! : null;
        }
        if (w.isaControlNumber) {
          for (const [key, id] of byIsa) {
            if (key.endsWith(`:${w.isaControlNumber}`)) return rows.get(id)!;
          }
        }
        if (w.id) return rows.get(w.id) ?? null;
        return null;
      },
      async count() { return rows.size; },
    },
    // Phase 6 — parseAndStore resolves the partner before persisting; no
    // partner configured in these tests, so return null.
    tradingPartner: {
      async findFirst() { return null; },
    },
    // Phase 9 Sprint 1.4 — parseAndStore now looks up OUR_ISA_IDS from the
    // tenant row. Null fallback matches the pre-Phase-9 default.
    tenant: {
      async findUnique() { return null; },
    },
    // Phase 8 Sprint 1 — propagateConfirmedAtForRawFile runs inside the
    // parse $transaction; tests here don't seed acks so [] is correct.
    transaction: {
      async findMany() { return []; },
      async updateMany() { return { count: 0 }; },
    },
  } as unknown as PrismaClient;
}

function multipart(content: Buffer, filename = 'po.edi'): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----b';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

test('empty file -> 400 EMPTY_FILE, nothing stored', async () => {
  const objects = new Map<string, Buffer>();
  const app = await buildServer({ config: testConfig, s3: okS3(objects), prisma: okPrisma() });
  const { payload, headers } = multipart(Buffer.alloc(0), 'empty.edi');
  const res = await app.inject({ method: 'POST', url: '/api/ingest/upload', payload, headers });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'EMPTY_FILE');
  assert.equal(objects.size, 0);
  await app.close();
});

test('non-X12 file -> 200 stored as UNRECOGNIZED_FORMAT', async () => {
  const objects = new Map<string, Buffer>();
  const app = await buildServer({ config: testConfig, s3: okS3(objects), prisma: okPrisma() });
  const { payload, headers } = multipart(Buffer.from('just a normal text file, definitely not edi'), 'notes.txt');
  const res = await app.inject({ method: 'POST', url: '/api/ingest/upload', payload, headers });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'UNRECOGNIZED_FORMAT');
  assert.equal(res.json().isaControlNumber, null);
  assert.equal(objects.size, 1, 'raw file still stored');
  await app.close();
});

test('malformed X12 (ISA present but unparseable) -> 200 stored as PARSE_ERROR', async () => {
  const objects = new Map<string, Buffer>();
  const app = await buildServer({ config: testConfig, s3: okS3(objects), prisma: okPrisma() });
  const { payload, headers } = multipart(Buffer.from('ISA*00*tooshort*broken~'), 'broken.edi');
  const res = await app.inject({ method: 'POST', url: '/api/ingest/upload', payload, headers });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'PARSE_ERROR');
  assert.equal(res.json().isaControlNumber, null);
  assert.equal(objects.size, 1, 'raw file still stored');
  await app.close();
});

test('DB unreachable -> 503 DB_UNAVAILABLE with NO S3 write (fail fast)', async () => {
  const objects = new Map<string, Buffer>();
  const downPrisma = {
    rawFile: {
      async findUnique() { throw new Error('ECONNREFUSED'); },
      async count() { throw new Error('ECONNREFUSED'); },
      async create() { throw new Error('ECONNREFUSED'); },
    },
  } as unknown as PrismaClient;
  const app = await buildServer({ config: testConfig, s3: okS3(objects), prisma: downPrisma });
  const { payload, headers } = multipart(validInterchange(), 'po.edi');
  const res = await app.inject({ method: 'POST', url: '/api/ingest/upload', payload, headers });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, 'DB_UNAVAILABLE');
  assert.equal(objects.size, 0, 'no bytes written to S3 when DB is down');
  await app.close();
});

test('GET /health -> 200 ok when DB and S3 are reachable', async () => {
  const app = await buildServer({ config: testConfig, s3: okS3(new Map()), prisma: okPrisma() });
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  // Phase 8 Sprint 2 — channels list is part of the response shape now.
  // `buildServer` doesn't boot channels (that's index.ts's job), so the list
  // is empty here. Asserting individual fields keeps the test future-proof.
  const body = res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.db, 'connected');
  assert.equal(body.s3, 'reachable');
  assert.deepEqual(body.channels, []);
  await app.close();
});

// Phase 10 Sprint 1.3 — dep-check moved from /health (liveness) to
// /readiness. /health now always returns 200 as long as the event loop
// is responsive; /readiness is what the ALB target group hits and what
// goes 503 when a dependency is down.

test('GET /readiness -> 503 not-ready when DB is down', async () => {
  const downPrisma = { rawFile: { async count() { throw new Error('db down'); } } } as unknown as PrismaClient;
  const app = await buildServer({ config: testConfig, s3: okS3(new Map()), prisma: downPrisma });
  const res = await app.inject({ method: 'GET', url: '/readiness' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().status, 'not-ready');
  assert.equal(res.json().db, 'error');
  assert.equal(res.json().s3, 'reachable');
  await app.close();
});

test('GET /readiness -> 503 not-ready when S3 is down', async () => {
  const downS3 = {
    config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) },
    async send() { throw new Error('s3 down'); },
  } as unknown as S3Client;
  const app = await buildServer({ config: testConfig, s3: downS3, prisma: okPrisma() });
  const res = await app.inject({ method: 'GET', url: '/readiness' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().s3, 'error');
  assert.equal(res.json().db, 'connected');
  await app.close();
});

// ─────────────────────────────────────────────────────────────
// Phase 8 Sprint 2 — /health surfaces channel status when registered.
// ─────────────────────────────────────────────────────────────

test('GET /health reports channel statuses when the registry is decorated', async () => {
  const app = await buildServer({ config: testConfig, s3: okS3(new Map()), prisma: okPrisma() });
  const channels: ChannelHealth[] = [
    { name: 'sftp', source: 'sftp', status: 'running', detail: { watchDir: '/tmp/sftp' } },
    { name: 'as2', source: 'as2', status: 'error', error: 'EACCES', detail: { inboxDir: '/tmp/as2' } },
  ];
  app.channels = {
    health: () => channels,
    closeAll: async () => {},
    ensureDesktopDropFolder: async () => {},
  };

  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.channels.length, 2);
  const sftp = body.channels.find((c: { name: string }) => c.name === 'sftp');
  const as2 = body.channels.find((c: { name: string }) => c.name === 'as2');
  assert.equal(sftp.status, 'running');
  assert.equal(as2.status, 'error');
  assert.equal(as2.error, 'EACCES');
  await app.close();
});
