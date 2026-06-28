/**
 * Phase 8 Sprint 2 — AS2 receive channel test.
 *
 * The AS2 channel is structurally a drop-folder watcher (OpenAS2 drops
 * plaintext EDI; we ingest). This test exercises it end-to-end against the
 * SAME in-memory S3/Prisma fakes the SFTP test uses, so the assertion is
 * "files arriving via the AS2 channel land with source='as2'" — not a full
 * AS2 handshake (the daemon owns that).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { startAs2Channel } from '../src/channels/as2.js';
import type { IngestionDeps } from '../src/services/ingestion.js';
import { S3StorageAdapter } from '../src/storage/s3-adapter.js';
import type { AppConfig } from '../src/config.js';



const toBuf = (b: unknown): Buffer => (Buffer.isBuffer(b) ? b : Buffer.from(b as Uint8Array));

const noopLogger = {
  info() {}, warn() {}, error() {}, debug() {}, fatal() {}, trace() {}, silent() {},
  child() { return noopLogger; },
} as unknown as FastifyBaseLogger;

function buildInterchange(isa13: string): string {
  const e = '*';
  const isa = [
    'ISA', '00', ' '.repeat(10), '00', ' '.repeat(10), 'ZZ', 'SENDER'.padEnd(15),
    'ZZ', 'RECEIVER'.padEnd(15), '260101', '1200', 'U', '00401', isa13, '0', 'P',
  ].join(e) + e + ':' + '~';
  return isa + 'GS*PO*SENDER*RECEIVER*20260101*1200*1*X*004010~ST*850*0001~SE*2*0001~';
}

function baseConfig(inboxDir: string, processedDir: string, failedDir: string): AppConfig {
  return {
    port: 0, nodeEnv: 'test', maxFileSizeBytes: 1024 * 1024,
    s3: { bucket: 'b', region: 'us-east-1', endpoint: 'http://localhost:9000', forcePathStyle: true },
    retry: { maxAttempts: 1, baseDelayMs: 1 },
    sftp: { enabled: false, watchDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
    as2: { enabled: true, inboxDir, processedDir, failedDir, stabilityThresholdMs: 50 },
    ourIsaIds: [],
    notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
    clerk: { secretKey: '', webhookSecret: '' },
  storage: { backend: 's3', localDataDir: '/tmp/edi-test' },
  alertSuppressionMinutes: 60,
    lanApiToken: '',
  cors: { allowedOrigins: [] },
  webStatic: { dir: "" },
  };
}

function okS3(objects: Map<string, Buffer>): S3Client {
  return {
    config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) },
    async send(command: { constructor: { name: string }; input?: Record<string, unknown> }) {
      const input = command.input ?? {};
      const name = command.constructor?.name;
      if (name === 'PutObjectCommand' || name === 'UploadPartCommand') { objects.set(String(input.Key), toBuf(input.Body)); return { ETag: '"ok"' }; }
      if (name === 'CreateMultipartUploadCommand') return { UploadId: 'u' };
      return {};
    },
  } as unknown as S3Client;
}

function fakePrisma(captured: { sources: string[] }): PrismaClient {
  const rows = new Map<string, { id: string; isaControlNumber?: string | null; source?: string }>();
  const byIsa = new Map<string, string>();
  const self: PrismaClient = {
    rawFile: {
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: String(data.id), ...(data as object) } as { id: string; isaControlNumber?: string | null; source?: string };
        rows.set(row.id, row);
        if (row.isaControlNumber) {
          const tenantId = String((data as { tenantId?: string }).tenantId ?? '');
          byIsa.set(`${tenantId}:${row.isaControlNumber}`, row.id);
        }
        if (row.source) captured.sources.push(row.source);
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
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = rows.get(where.id); if (row) Object.assign(row, data); return row ?? {};
      },
      async count() { return rows.size; },
    },
    interchange: {
      async deleteMany() { return { count: 0 }; },
      async create() { return { id: 'ic-1' }; },
    },
    transaction: {
      async findMany() { return []; },
      async updateMany() { return { count: 0 }; },
    },
    tradingPartner: { async findFirst() { return null; } },
    // Phase 9 Sprint 1.4 — parseAndStore looks up OUR_ISA_IDS from the tenant.
    tenant: { async findUnique() { return null; } },
    async $transaction(fn: (tx: unknown) => unknown) { return fn(self); },
  } as unknown as PrismaClient;
  return self;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('AS2 channel ingests a dropped file with source=as2 and reports running status', async () => {
  const base = await mkdtemp(join(tmpdir(), 'edi-as2-'));
  const inboxDir = join(base, 'inbox');
  const processedDir = join(base, 'processed');
  const failedDir = join(base, 'failed');
  await mkdir(inboxDir, { recursive: true });

  const config = baseConfig(inboxDir, processedDir, failedDir);
  const objects = new Map<string, Buffer>();
  const captured = { sources: [] as string[] };
  const deps: IngestionDeps = { s3: okS3(objects), storage: new S3StorageAdapter(okS3(objects), config.s3.bucket), prisma: fakePrisma(captured), config, logger: noopLogger };

  const channel = await startAs2Channel(deps, config.as2);
  await channel.ready;

  // Channel reports itself as running and tagged with the right source.
  const status = channel.status();
  assert.equal(status.name, 'as2');
  assert.equal(status.source, 'as2');
  assert.equal(status.status, 'running');
  assert.equal(status.detail?.watchDir, inboxDir);

  await writeFile(join(inboxDir, 'partner-msg-001.edi'), buildInterchange('000044100'));

  await waitFor(() => objects.size === 1);
  await waitFor(async () => {
    try { return (await readdir(processedDir)).length === 1; } catch { return false; }
  });
  assert.deepEqual(await readdir(processedDir), ['partner-msg-001.edi']);
  assert.equal((await readdir(inboxDir)).length, 0, 'inbox is drained');

  // The raw_files row carries source='as2', not 'sftp' or 'upload'.
  assert.deepEqual(captured.sources, ['as2']);

  await channel.close();
});
