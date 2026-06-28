/**
 * Runtime integration tests for the ingestion endpoint + status routes.
 *
 * Exercises the real route/service wiring (multipart, dedup, retry, response
 * shapes, pagination) with in-memory fakes for S3 and Prisma, so it runs in CI
 * with no Postgres or MinIO. The live end-to-end check is test/smoke.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { buildServer } from '../src/server.js';
import type { AppConfig } from '../src/config.js';

const testConfig: AppConfig = {
  port: 0,
  nodeEnv: 'test',
  maxFileSizeBytes: 25 * 1024 * 1024,
  s3: { bucket: 'test-bucket', region: 'us-east-1', endpoint: 'http://localhost:9000', forcePathStyle: true },
  retry: { maxAttempts: 3, baseDelayMs: 1 },
  sftp: { enabled: false, watchDir: './.sftp/incoming', processedDir: './.sftp/processed', failedDir: './.sftp/failed', stabilityThresholdMs: 50 },
  as2: { enabled: false, inboxDir: './.as2/inbox', processedDir: './.as2/processed', failedDir: './.as2/failed', stabilityThresholdMs: 50 },
  ourIsaIds: [],
  notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
  clerk: { secretKey: '', webhookSecret: '' },
  storage: { backend: 's3', localDataDir: '/tmp/edi-test' },
  alertSuppressionMinutes: 60,
    lanApiToken: '',
  cors: { allowedOrigins: [] },
  webStatic: { dir: "" },
};

const toBuf = (b: unknown): Buffer => (Buffer.isBuffer(b) ? b : Buffer.from(b as Uint8Array));

/** Build a spec-length (106-char ISA) interchange so dedup has a real ISA13. */
function buildInterchange(isa13: string): Buffer {
  const e = '*';
  const isa = [
    'ISA', '00', ' '.repeat(10), '00', ' '.repeat(10), 'ZZ', 'SENDER'.padEnd(15),
    'ZZ', 'RECEIVER'.padEnd(15), '260101', '1200', 'U', '00401', isa13, '0', 'P',
  ].join(e) + e + ':' + '~';
  const body = [
    'GS*PO*SENDER*RECEIVER*20260101*1200*1*X*004010',
    'ST*850*0001',
    `BEG*00*SA*PO-${isa13}**20260101`,
    'PO1*1*1*EA*1.00**VP*X',
    'SE*4*0001',
    'GE*1*1',
    `IEA*1*${isa13}`,
  ].join('~') + '~';
  return Buffer.from(isa + body);
}

function makeFakeS3(): { client: S3Client; objects: Map<string, Buffer>; putCount: () => number } {
  const objects = new Map<string, Buffer>();
  const parts = new Map<string, Map<number, Buffer>>();
  let puts = 0;
  const client = {
    config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) },
    async send(command: { constructor: { name: string }; input?: Record<string, unknown> }) {
      const name = command.constructor?.name ?? '';
      const input = command.input ?? {};
      const key = String(input.Key ?? '');
      switch (name) {
        case 'PutObjectCommand': puts += 1; objects.set(key, toBuf(input.Body)); return { ETag: '"single"' };
        case 'CreateMultipartUploadCommand': parts.set(key, new Map()); return { UploadId: 'u-' + key };
        case 'UploadPartCommand': { puts += 1; const m = parts.get(key) ?? new Map(); m.set(Number(input.PartNumber), toBuf(input.Body)); parts.set(key, m); return { ETag: `"p${input.PartNumber}"` }; }
        case 'CompleteMultipartUploadCommand': { const m = parts.get(key) ?? new Map<number, Buffer>(); objects.set(key, Buffer.concat([...m.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b))); return {}; }
        default: return {};
      }
    },
  } as unknown as S3Client;
  return { client, objects, putCount: () => puts };
}

interface Row { id: string; tenantId: string; s3Key: string; fileHash: string; isaControlNumber: string | null; source: string; status: string; errorMessage: string | null; ingestedAt: Date }

function isaKey(tenantId: string, isa: string): string {
  return `${tenantId}:${isa}`;
}

function makeFakePrisma(): { client: PrismaClient; rows: Map<string, Row>; interchanges: Map<string, unknown> } {
  const rows = new Map<string, Row>();
  const byIsa = new Map<string, string>();
  const interchanges = new Map<string, unknown>();
  let icSeq = 0;
  const client = {
    rawFile: {
      async create({ data }: { data: Record<string, unknown> }) {
        const row: Row = {
          tenantId: String(data.tenantId ?? ''),
          errorMessage: null,
          ingestedAt: (data.ingestedAt as Date) ?? new Date(),
          ...(data as object),
        } as Row;
        rows.set(row.id, row);
        if (row.isaControlNumber) byIsa.set(isaKey(row.tenantId, row.isaControlNumber), row.id);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = rows.get(where.id)!;
        Object.assign(row, data);
        return row;
      },
      async findUnique({ where }: { where: Record<string, unknown> }) {
        const w = where as {
          id?: string;
          s3Key?: string;
          isaControlNumber?: string;
          tenantId_isaControlNumber?: { tenantId: string; isaControlNumber: string };
        };
        if (w.tenantId_isaControlNumber) {
          const { tenantId, isaControlNumber } = w.tenantId_isaControlNumber;
          const id = byIsa.get(isaKey(tenantId, isaControlNumber));
          return id ? rows.get(id)! : null;
        }
        if (w.id) return rows.get(w.id) ?? null;
        if (w.isaControlNumber) {
          for (const r of rows.values()) {
            if (r.isaControlNumber === w.isaControlNumber) return r;
          }
        }
        if (w.s3Key) { for (const r of rows.values()) if (r.s3Key === w.s3Key) return r; }
        return null;
      },
      async findMany({ take, skip }: { take?: number; skip?: number } = {}) {
        let arr = [...rows.values()].sort((a, b) => b.ingestedAt.getTime() - a.ingestedAt.getTime());
        if (skip) arr = arr.slice(skip);
        if (take != null) arr = arr.slice(0, take);
        return arr;
      },
      async count() {
        return rows.size;
      },
    },
    interchange: {
      async deleteMany({ where }: { where: { rawFileId: string } }) {
        let count = 0;
        for (const [id, ic] of interchanges) {
          if ((ic as { rawFileId: string }).rawFileId === where.rawFileId) { interchanges.delete(id); count += 1; }
        }
        return { count };
      },
      async create({ data }: { data: unknown }) {
        const id = `ic-${(icSeq += 1)}`;
        interchanges.set(id, data);
        return { id };
      },
    },
    // Phase 6 — parseAndStore resolves the partner before persisting; no
    // partner record configured in these tests, so return null/[] (backward compat).
    //
    // D1 Sprint 3 — Option A switched resolvePartnerByIsa to findMany + JS
    // membership. Stub both shapes so the resolver returns null cleanly
    // instead of throwing on a missing method (which parseAndStore would
    // swallow, leaving the row at RECEIVED).
    tradingPartner: {
      async findFirst() { return null; },
      async findMany() { return []; },
    },
    // Phase 8 Sprint 1 — parseAndStore now calls
    // `propagateConfirmedAtForRawFile`, which scans this rawFile's parsed
    // 997s/999s and updates the originals they ack. Tests here ingest a
    // single 850 (no acks), so findMany returns [] and updateMany is never
    // hit — but the stubs need to exist so the call doesn't throw and silently
    // demote the row from PARSED back to RECEIVED.
    transaction: {
      async findMany() { return []; },
      async updateMany() { return { count: 0 }; },
    },
    // Phase 9 Sprint 1.4 — parseAndStore looks up OUR_ISA_IDS from the
    // tenant row. Null means "no IDs configured" (parser direction → unknown,
    // matching the pre-Phase-9 default for these fixtures).
    tenant: {
      async findUnique() { return null; },
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(client);
    },
    async $disconnect() {},
  } as unknown as PrismaClient;
  return { client, rows, interchanges };
}

function multipart(content: Buffer, filename = 'po.edi'): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----b';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/edi-x12\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

test('upload stores raw bytes, records the row, and extracts the ISA control number', async () => {
  const content = buildInterchange('000000123');
  const expectedHash = createHash('sha256').update(content).digest('hex');
  const { client: s3, objects } = makeFakeS3();
  const { client: prisma, rows, interchanges } = makeFakePrisma();
  const app = await buildServer({ config: testConfig, s3, prisma });

  const { payload, headers } = multipart(content);
  const res = await app.inject({ method: 'POST', url: '/api/ingest/upload', payload, headers });

  assert.equal(res.statusCode, 200, res.body);
  const json = res.json();
  assert.equal(json.status, 'PARSED', 'inline parse runs and promotes status to PARSED');
  assert.equal(interchanges.size, 1, 'an interchange tree was persisted');
  assert.equal(json.duplicate, false);
  assert.equal(json.isaControlNumber, '000000123');
  assert.equal(json.fileHash, expectedHash);
  assert.ok(objects.get(json.s3Key)?.equals(content), 'bytes stored in S3');
  assert.equal(rows.get(json.id)?.isaControlNumber, '000000123');
  await app.close();
});

test('duplicate ISA control number is rejected idempotently with no second S3 write', async () => {
  const content = buildInterchange('000000777');
  const { client: s3, putCount } = makeFakeS3();
  const { client: prisma, rows } = makeFakePrisma();
  const app = await buildServer({ config: testConfig, s3, prisma });
  const { payload, headers } = multipart(content);

  const first = await app.inject({ method: 'POST', url: '/api/ingest/upload', payload, headers });
  const second = await app.inject({ method: 'POST', url: '/api/ingest/upload', payload, headers });

  assert.equal(first.statusCode, 200);
  assert.equal(first.json().duplicate, false);
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().duplicate, true);
  assert.equal(second.json().status, 'DUPLICATE');
  assert.equal(second.json().id, first.json().id, 'duplicate returns the original id');
  assert.equal(rows.size, 1, 'only one row');
  assert.equal(putCount(), 1, 'only one S3 write across both attempts');
  await app.close();
});

test('transient S3 errors are retried, then succeed', async () => {
  const objects = new Map<string, Buffer>();
  let calls = 0;
  const flakyS3 = {
    config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) },
    async send(command: { constructor: { name: string }; input?: Record<string, unknown> }) {
      if (command.constructor?.name === 'PutObjectCommand') {
        calls += 1;
        if (calls <= 2) { const e = new Error('throttled') as Error & { $metadata?: unknown }; e.$metadata = { httpStatusCode: 503 }; throw e; }
        objects.set(String(command.input?.Key), toBuf(command.input?.Body));
        return { ETag: '"ok"' };
      }
      return {};
    },
  } as unknown as S3Client;
  const { client: prisma, rows } = makeFakePrisma();
  const app = await buildServer({ config: testConfig, s3: flakyS3, prisma });

  const { payload, headers } = multipart(buildInterchange('000000999'));
  const res = await app.inject({ method: 'POST', url: '/api/ingest/upload', payload, headers });

  assert.equal(res.statusCode, 200, res.body);
  assert.equal(calls, 3, 'two failures then a success');
  assert.equal(rows.size, 1);
  await app.close();
});

test('non-X12 file is stored without an ISA control number (no dedup)', async () => {
  const { client: s3, objects } = makeFakeS3();
  const { client: prisma } = makeFakePrisma();
  const app = await buildServer({ config: testConfig, s3, prisma });
  const { payload, headers } = multipart(Buffer.from('this is definitely not an edi file'), 'notes.txt');
  const res = await app.inject({ method: 'POST', url: '/api/ingest/upload', payload, headers });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().isaControlNumber, null);
  assert.equal(res.json().status, 'UNRECOGNIZED_FORMAT');
  assert.equal(objects.size, 1, 'raw file is still stored');
  await app.close();
});

test('GET /ingest/:id returns the record; unknown id is 404', async () => {
  const { client: s3 } = makeFakeS3();
  const { client: prisma } = makeFakePrisma();
  const app = await buildServer({ config: testConfig, s3, prisma });
  const { payload, headers } = multipart(buildInterchange('000000555'));
  const created = (await app.inject({ method: 'POST', url: '/api/ingest/upload', payload, headers })).json();

  const found = await app.inject({ method: 'GET', url: `/api/ingest/${created.id}` });
  assert.equal(found.statusCode, 200);
  assert.equal(found.json().s3Key, created.s3Key);
  assert.equal(found.json().isaControlNumber, '000000555');

  const missing = await app.inject({ method: 'GET', url: '/api/ingest/does-not-exist' });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'NOT_FOUND');
  await app.close();
});

test('GET /ingest lists ingestions newest-first with pagination', async () => {
  const { client: s3 } = makeFakeS3();
  const { client: prisma } = makeFakePrisma();
  const app = await buildServer({ config: testConfig, s3, prisma });
  for (const isa of ['000000001', '000000002', '000000003']) {
    const { payload, headers } = multipart(buildInterchange(isa));
    await app.inject({ method: 'POST', url: '/api/ingest/upload', payload, headers });
  }
  const list = await app.inject({ method: 'GET', url: '/api/ingest?limit=2&offset=0' });
  assert.equal(list.statusCode, 200);
  const body = list.json();
  assert.equal(body.limit, 2);
  assert.equal(body.items.length, 2);
  assert.equal(body.count, 2);
  await app.close();
});

test('no file field returns 400 NO_FILE', async () => {
  const { client: s3 } = makeFakeS3();
  const { client: prisma } = makeFakePrisma();
  const app = await buildServer({ config: testConfig, s3, prisma });
  const payload = Buffer.from('------b\r\nContent-Disposition: form-data; name="note"\r\n\r\nhi\r\n------b--\r\n');
  const res = await app.inject({ method: 'POST', url: '/api/ingest/upload', payload, headers: { 'content-type': 'multipart/form-data; boundary=----b' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'NO_FILE');
  await app.close();
});
