/**
 * Desktop track D8 Sprint 2 — setup route tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PrismaClient } from '@prisma/client';
import type { S3Client } from '@aws-sdk/client-s3';
import { buildServer } from '../src/server.js';
import { startConfiguredChannels } from '../src/channels/registry.js';
import type { IngestionDeps } from '../src/services/ingestion.js';
import type { FastifyBaseLogger } from 'fastify';
import { S3StorageAdapter } from '../src/storage/s3-adapter.js';
import type { AppConfig } from '../src/config.js';
import type { AuthOutcome } from '../src/services/auth.js';

const noopLogger = {
  info() {}, warn() {}, error() {}, debug() {}, fatal() {}, trace() {}, silent() {},
  child() { return noopLogger; },
} as unknown as FastifyBaseLogger;

const fakeS3 = {} as unknown as S3Client;

function makeConfig(): AppConfig {
  return {
    port: 3000,
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
    webStatic: { dir: '' },
  } as AppConfig;
}

const fakePrisma = (() => {
  let ourIsaIds: string[] = [];
  const self: {
    rawFile: { count: () => Promise<number> };
    tenant: {
      findUnique: () => Promise<{ ourIsaIds: string[] }>;
      update: (args: { data: { ourIsaIds: string[] } }) => Promise<{ id: string; ourIsaIds: string[] }>;
    };
    auditEvent: { create: () => Promise<Record<string, never>> };
    $transaction: <T>(fn: (tx: typeof self) => Promise<T>) => Promise<T>;
  } = {
    rawFile: {
      async count() {
        return 0;
      },
    },
    tenant: {
      async findUnique() {
        return { ourIsaIds };
      },
      async update({ data }) {
        ourIsaIds = data.ourIsaIds;
        return { id: 'tenant-1', ourIsaIds };
      },
    },
    auditEvent: {
      async create() {
        return {};
      },
    },
    async $transaction<T>(fn: (tx: typeof self) => Promise<T>): Promise<T> {
      return fn(self);
    },
  };
  return self;
})() as unknown as PrismaClient;

async function buildTestApp() {
  const config = makeConfig();
  const verifyAuth = async (): Promise<AuthOutcome> => ({ kind: 'dev-fallback' });
  const app = await buildServer({ config, prisma: fakePrisma, s3: fakeS3, verifyAuth });
  const deps: IngestionDeps = {
    s3: fakeS3,
    storage: new S3StorageAdapter(fakeS3, config.s3.bucket),
    prisma: fakePrisma,
    config,
    logger: noopLogger,
  };
  app.decorate('channels', await startConfiguredChannels(deps, config));
  return app;
}

async function closeTestApp(app: Awaited<ReturnType<typeof buildTestApp>>): Promise<void> {
  if (app.channels) await app.channels.closeAll();
  await app.close();
}

test('GET /api/setup reports desktop wizard incomplete on fresh install', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edi-setup-'));
  const prev = process.env.EDI_HUB_USER_DATA_DIR;
  process.env.EDI_HUB_USER_DATA_DIR = dir;
  const app = await buildTestApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/setup' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { firstRunComplete: boolean; desktopMode: boolean };
    assert.equal(body.desktopMode, true);
    assert.equal(body.firstRunComplete, false);
    const server = (body as { server?: { redirectOrigins: string[] } }).server;
    assert.ok(server);
    assert.ok(server!.redirectOrigins.length >= 2);
    assert.ok(server!.redirectOrigins.some((o) => o.includes('127.0.0.1')));
  } finally {
    await closeTestApp(app);
    if (prev) process.env.EDI_HUB_USER_DATA_DIR = prev;
    else delete process.env.EDI_HUB_USER_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});

test('PATCH /api/setup completes wizard and starts desktop-drop channel', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edi-setup-'));
  const dropDir = join(dir, 'incoming');
  const prev = process.env.EDI_HUB_USER_DATA_DIR;
  process.env.EDI_HUB_USER_DATA_DIR = dir;
  const app = await buildTestApp();
  try {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/setup',
      headers: { 'content-type': 'application/json' },
      payload: {
        dropFolderPath: dropDir,
        telemetryEnabled: true,
        firstRunComplete: true,
      },
    });
    assert.equal(patch.statusCode, 200);
    const body = patch.json() as { firstRunComplete: boolean; dropFolderPath: string };
    assert.equal(body.firstRunComplete, true);
    assert.equal(body.dropFolderPath, dropDir);

    const readiness = await app.inject({ method: 'GET', url: '/readiness' });
    const channels = (readiness.json() as { channels: Array<{ name: string; status: string }> }).channels;
    const desktop = channels.find((c) => c.name === 'desktop-drop');
    assert.ok(desktop);
    assert.equal(desktop!.status, 'running');
  } finally {
    await closeTestApp(app);
    if (prev) process.env.EDI_HUB_USER_DATA_DIR = prev;
    else delete process.env.EDI_HUB_USER_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});

test('GET /api/setup is always complete in SaaS mode', async () => {
  const prev = process.env.EDI_HUB_USER_DATA_DIR;
  delete process.env.EDI_HUB_USER_DATA_DIR;
  const app = await buildTestApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/setup' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { firstRunComplete: boolean; desktopMode: boolean; ourIsaIds: string[] };
    assert.equal(body.desktopMode, false);
    assert.equal(body.firstRunComplete, true);
    assert.deepEqual(body.ourIsaIds, []);
  } finally {
    await closeTestApp(app);
    if (prev) process.env.EDI_HUB_USER_DATA_DIR = prev;
  }
});

test('PATCH /api/setup persists ourIsaIds on the tenant', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edi-setup-'));
  const prev = process.env.EDI_HUB_USER_DATA_DIR;
  process.env.EDI_HUB_USER_DATA_DIR = dir;
  const app = await buildTestApp();
  try {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/setup',
      headers: { 'content-type': 'application/json' },
      payload: { ourIsaIds: ['7085892400'] },
    });
    assert.equal(patch.statusCode, 200);
    const body = patch.json() as { ourIsaIds: string[] };
    assert.deepEqual(body.ourIsaIds, ['7085892400']);
  } finally {
    await closeTestApp(app);
    if (prev) process.env.EDI_HUB_USER_DATA_DIR = prev;
    else delete process.env.EDI_HUB_USER_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});

test('PATCH /api/setup persists ourIsaIds in SaaS mode', async () => {
  const prev = process.env.EDI_HUB_USER_DATA_DIR;
  delete process.env.EDI_HUB_USER_DATA_DIR;
  const app = await buildTestApp();
  try {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/setup',
      headers: { 'content-type': 'application/json' },
      payload: { ourIsaIds: ['WEBSENDER01'] },
    });
    assert.equal(patch.statusCode, 200);
    const body = patch.json() as { ourIsaIds: string[]; desktopMode: boolean };
    assert.equal(body.desktopMode, false);
    assert.deepEqual(body.ourIsaIds, ['WEBSENDER01']);
  } finally {
    await closeTestApp(app);
    if (prev) process.env.EDI_HUB_USER_DATA_DIR = prev;
  }
});

test('PATCH /api/setup rejects desktop-only fields in SaaS mode', async () => {
  const prev = process.env.EDI_HUB_USER_DATA_DIR;
  delete process.env.EDI_HUB_USER_DATA_DIR;
  const app = await buildTestApp();
  try {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/setup',
      headers: { 'content-type': 'application/json' },
      payload: { dropFolderPath: '/tmp/whatever' },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { error: { code: string } };
    assert.equal(body.error.code, 'NOT_DESKTOP');
  } finally {
    await closeTestApp(app);
    if (prev) process.env.EDI_HUB_USER_DATA_DIR = prev;
  }
});

test('POST /api/setup/verify-auth rejects dev-fallback without Clerk session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edi-setup-verify-'));
  const prev = process.env.EDI_HUB_USER_DATA_DIR;
  process.env.EDI_HUB_USER_DATA_DIR = dir;
  const app = await buildTestApp();
  try {
    const res = await app.inject({ method: 'POST', url: '/api/setup/verify-auth' });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: { code: string } }).error.code, 'CLERK_NOT_VERIFIED');
  } finally {
    await closeTestApp(app);
    if (prev) process.env.EDI_HUB_USER_DATA_DIR = prev;
    else delete process.env.EDI_HUB_USER_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});
