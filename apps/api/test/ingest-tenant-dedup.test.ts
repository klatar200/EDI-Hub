/**
 * FIX_PLAN W1.2 — ISA control-number dedup is scoped per tenant.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { tenantContext, PILOT_TENANT_ID } from '@edi/db';
import { ingestRawFile } from '../src/services/ingestion.js';
import type { AppConfig } from '../src/config.js';
import type { StorageAdapter } from '../src/storage/interface.js';
import type { Readable } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';

const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const testConfig: AppConfig = {
  port: 0,
  nodeEnv: 'test',
  maxFileSizeBytes: 25 * 1024 * 1024,
  s3: { bucket: 'test-bucket', region: 'us-east-1', endpoint: 'http://localhost:9000', forcePathStyle: true },
  retry: { maxAttempts: 1, baseDelayMs: 1 },
  sftp: { enabled: false, watchDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 50 },
  as2: { enabled: false, inboxDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 50 },
  ourIsaIds: [],
  notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
  clerk: { secretKey: '', webhookSecret: '' },
  storage: { backend: 's3', localDataDir: '/tmp/edi-test' },
  alertSuppressionMinutes: 60,
    lanApiToken: '',
  cors: { allowedOrigins: [] },
  webStatic: { dir: '' },
};

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

interface Row {
  id: string;
  tenantId: string;
  s3Key: string;
  fileHash: string;
  isaControlNumber: string | null;
  source: string;
  status: string;
  errorMessage: string | null;
  ingestedAt: Date;
}

function isaCompositeKey(tenantId: string, isa: string): string {
  return `${tenantId}:${isa}`;
}

function makeFakePrisma() {
  const rows = new Map<string, Row>();
  const byIsa = new Map<string, string>();

  const client = {
    rawFile: {
      async create({ data }: { data: Record<string, unknown> }) {
        const row = {
          errorMessage: null,
          ingestedAt: (data.ingestedAt as Date) ?? new Date(),
          ...(data as object),
        } as Row;
        rows.set(row.id, row);
        if (row.isaControlNumber) {
          byIsa.set(isaCompositeKey(row.tenantId, row.isaControlNumber), row.id);
        }
        return row;
      },
      async findUnique({ where }: { where: Record<string, unknown> }) {
        const w = where as {
          id?: string;
          tenantId_isaControlNumber?: { tenantId: string; isaControlNumber: string };
        };
        if (w.tenantId_isaControlNumber) {
          const { tenantId, isaControlNumber } = w.tenantId_isaControlNumber;
          const id = byIsa.get(isaCompositeKey(tenantId, isaControlNumber));
          return id ? rows.get(id) ?? null : null;
        }
        if (w.id) return rows.get(w.id) ?? null;
        return null;
      },
      async count() {
        return rows.size;
      },
    },
    tradingPartner: { async findFirst() { return null; }, async findMany() { return []; } },
    interchange: {
      async deleteMany() { return { count: 0 }; },
      async create({ data }: { data: unknown }) {
        return { id: 'ic-1', ...(data as object) };
      },
    },
    transaction: { async findMany() { return []; }, async updateMany() { return { count: 0 }; } },
    tenant: { async findUnique() { return null; } },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(client);
    },
  } as unknown as PrismaClient;

  return { client, rows };
}

function makeStorage(): StorageAdapter {
  const objects = new Map<string, Buffer>();
  return {
    buildKey(id: string, ingestedAt = new Date()) {
      return `raw/${ingestedAt.toISOString().slice(0, 10)}/${id}.edi`;
    },
    async upload(key: string, body: Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks));
      return { key };
    },
    async download(key: string) {
      const buf = objects.get(key);
      if (!buf) throw new Error('missing');
      return buf;
    },
  };
}

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  child() { return this; },
} as unknown as FastifyBaseLogger;

test('same ISA control number under two tenants stores two rows', async () => {
  const content = buildInterchange('000000424');
  const { client: prisma, rows } = makeFakePrisma();
  const storage = makeStorage();
  const s3 = { config: {} } as S3Client;
  const deps = { s3, storage, prisma, config: testConfig, logger: noopLogger };

  const first = await tenantContext.run({ tenantId: PILOT_TENANT_ID }, () =>
    ingestRawFile(deps, { content, source: 'upload' }),
  );
  const second = await tenantContext.run({ tenantId: TENANT_B }, () =>
    ingestRawFile(deps, { content, source: 'upload' }),
  );

  assert.equal(first.outcome, 'stored');
  assert.equal(second.outcome, 'stored');
  assert.notEqual(first.id, second.id);
  assert.equal(rows.size, 2);
});

test('re-ingesting the same ISA under the same tenant is idempotent', async () => {
  const content = buildInterchange('000000425');
  const { client: prisma, rows } = makeFakePrisma();
  const storage = makeStorage();
  const s3 = { config: {} } as S3Client;
  const deps = { s3, storage, prisma, config: testConfig, logger: noopLogger };

  const first = await tenantContext.run({ tenantId: PILOT_TENANT_ID }, () =>
    ingestRawFile(deps, { content, source: 'upload' }),
  );
  const second = await tenantContext.run({ tenantId: PILOT_TENANT_ID }, () =>
    ingestRawFile(deps, { content, source: 'upload' }),
  );

  assert.equal(first.outcome, 'stored');
  assert.equal(second.outcome, 'duplicate');
  assert.equal(rows.size, 1);
});
