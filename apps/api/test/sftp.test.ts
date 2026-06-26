/**
 * Runtime test for the SFTP folder-watch channel.
 *
 * Drops a file into a temp watch folder and asserts it is ingested through the
 * shared pipeline and moved to /processed. Uses in-memory S3/Prisma fakes and a
 * real chokidar watcher over a real temp directory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { startSftpWatcher } from '../src/sftp/watcher.js';
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

function baseConfig(watchDir: string, processedDir: string, failedDir: string): AppConfig {
  return {
    port: 0, nodeEnv: 'test', maxFileSizeBytes: 1024 * 1024,
    s3: { bucket: 'b', region: 'us-east-1', endpoint: 'http://localhost:9000', forcePathStyle: true },
    retry: { maxAttempts: 1, baseDelayMs: 1 },
    sftp: { enabled: true, watchDir, processedDir, failedDir, stabilityThresholdMs: 50 },
    as2: { enabled: false, inboxDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
    ourIsaIds: [],
    notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
    clerk: { secretKey: '', webhookSecret: '' },
  storage: { backend: 's3', localDataDir: '/tmp/edi-test' },
  alertSuppressionMinutes: 60,
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

function fakePrisma(): PrismaClient {
  const rows = new Map<string, { id: string; isaControlNumber?: string | null }>();
  const byIsa = new Map<string, string>();
  const self: PrismaClient = {
    rawFile: {
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: String(data.id), ...(data as object) } as { id: string; isaControlNumber?: string | null };
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
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = rows.get(where.id); if (row) Object.assign(row, data); return row ?? {};
      },
      async count() { return rows.size; },
    },
    interchange: {
      async deleteMany() { return { count: 0 }; },
      async create() { return { id: 'ic-1' }; },
    },
    // Phase 9 Sprint 1.4 — parseAndStore looks up OUR_ISA_IDS from the tenant.
    tenant: {
      async findUnique() { return null; },
    },
    // Phase 8 Sprint 1 — propagateConfirmedAtForRawFile stubs.
    transaction: {
      async findMany() { return []; },
      async updateMany() { return { count: 0 }; },
    },
    // Phase 6 — parseAndStore resolves partner; tests here don't configure one.
    tradingPartner: {
      async findFirst() { return null; },
    },
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

test('SFTP watcher ingests a dropped file and moves it to /processed', async () => {
  const base = await mkdtemp(join(tmpdir(), 'edi-sftp-'));
  const watchDir = join(base, 'incoming');
  const processedDir = join(base, 'processed');
  const failedDir = join(base, 'failed');
  await mkdir(watchDir, { recursive: true });

  const config = baseConfig(watchDir, processedDir, failedDir);
  const objects = new Map<string, Buffer>();
  const deps: IngestionDeps = { s3: okS3(objects), storage: new S3StorageAdapter(okS3(objects), config.s3.bucket), prisma: fakePrisma(), config, logger: noopLogger };

  const watcher = await startSftpWatcher(deps, config.sftp);
  await watcher.ready;
  await writeFile(join(watchDir, 'drop_850.edi'), buildInterchange('000012345'));

  await waitFor(() => objects.size === 1);
  await waitFor(async () => {
    try { return (await readdir(processedDir)).length === 1; } catch { return false; }
  });

  assert.deepEqual(await readdir(processedDir), ['drop_850.edi'], 'file moved to processed');
  assert.equal((await readdir(watchDir)).length, 0, 'watch folder is drained');
  await watcher.close();
});

test('SFTP watcher moves a file to /failed on storage error', async () => {
  const base = await mkdtemp(join(tmpdir(), 'edi-sftp-fail-'));
  const watchDir = join(base, 'incoming');
  const processedDir = join(base, 'processed');
  const failedDir = join(base, 'failed');
  await mkdir(watchDir, { recursive: true });

  const config = baseConfig(watchDir, processedDir, failedDir);
  const objects = new Map<string, Buffer>();
  const failingS3 = {
    config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) },
    async send() { const e = new Error('down') as Error & { $metadata?: unknown }; e.$metadata = { httpStatusCode: 500 }; throw e; },
  } as unknown as S3Client;
  const deps: IngestionDeps = { s3: failingS3, storage: new S3StorageAdapter(failingS3, config.s3.bucket), prisma: fakePrisma(), config, logger: noopLogger };

  const watcher = await startSftpWatcher(deps, config.sftp);
  await watcher.ready;
  await writeFile(join(watchDir, 'bad_850.edi'), buildInterchange('000067890'));

  await waitFor(async () => {
    try { return (await readdir(failedDir)).length === 1; } catch { return false; }
  });
  assert.deepEqual(await readdir(failedDir), ['bad_850.edi']);
  assert.equal(objects.size, 0);
  await watcher.close();
});
