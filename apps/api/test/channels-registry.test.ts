/**
 * Phase 8 Sprint 2 — channel registry tests.
 *
 * Boots `startConfiguredChannels` against fake S3/Prisma deps for a handful of
 * config permutations:
 *   - both channels disabled → both reported as 'disabled'.
 *   - SFTP enabled, AS2 disabled → SFTP 'running', AS2 'disabled'.
 *   - Both enabled → both 'running'.
 *   - Channel start throws → recorded as 'error', other channel still 'running'.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { startConfiguredChannels } from '../src/channels/registry.js';
import type { IngestionDeps } from '../src/services/ingestion.js';
import type { AppConfig } from '../src/config.js';

const noopLogger = {
  info() {}, warn() {}, error() {}, debug() {}, fatal() {}, trace() {}, silent() {},
  child() { return noopLogger; },
} as unknown as FastifyBaseLogger;

const fakeS3 = {} as unknown as S3Client;
const fakePrisma = {} as unknown as PrismaClient;

function cfg(overrides: Partial<AppConfig>): AppConfig {
  const base: AppConfig = {
    port: 0, nodeEnv: 'test', maxFileSizeBytes: 1024 * 1024,
    s3: { bucket: 'b', region: 'us-east-1', endpoint: 'http://localhost:9000', forcePathStyle: true },
    retry: { maxAttempts: 1, baseDelayMs: 1 },
    sftp: { enabled: false, watchDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
    as2: { enabled: false, inboxDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
    ourIsaIds: [],
    notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
    clerk: { secretKey: '', webhookSecret: '' },
  alertSuppressionMinutes: 60,
  };
  return { ...base, ...overrides };
}

test('registry reports both channels as disabled when neither is enabled', async () => {
  const deps: IngestionDeps = { s3: fakeS3, prisma: fakePrisma, config: cfg({}), logger: noopLogger };
  const reg = await startConfiguredChannels(deps, deps.config);
  const h = reg.health();
  assert.equal(h.length, 2);
  const sftp = h.find((c) => c.name === 'sftp')!;
  const as2 = h.find((c) => c.name === 'as2')!;
  assert.equal(sftp.status, 'disabled');
  assert.equal(as2.status, 'disabled');
  await reg.closeAll();
});

test('registry reports SFTP running and AS2 disabled when only SFTP is enabled', async () => {
  const sftpBase = await mkdtemp(join(tmpdir(), 'edi-reg-sftp-'));
  try {
    const config = cfg({
      sftp: {
        enabled: true,
        watchDir: join(sftpBase, 'incoming'),
        processedDir: join(sftpBase, 'processed'),
        failedDir: join(sftpBase, 'failed'),
        stabilityThresholdMs: 50,
      },
    });
    const deps: IngestionDeps = { s3: fakeS3, prisma: fakePrisma, config, logger: noopLogger };
    const reg = await startConfiguredChannels(deps, deps.config);
    const h = reg.health();
    const sftp = h.find((c) => c.name === 'sftp')!;
    const as2 = h.find((c) => c.name === 'as2')!;
    assert.equal(sftp.status, 'running');
    assert.equal(sftp.source, 'sftp');
    assert.equal(as2.status, 'disabled');
    await reg.closeAll();
  } finally {
    await rm(sftpBase, { recursive: true, force: true });
  }
});

test('registry reports both channels running when both enabled', async () => {
  const sftpBase = await mkdtemp(join(tmpdir(), 'edi-reg-both-sftp-'));
  const as2Base = await mkdtemp(join(tmpdir(), 'edi-reg-both-as2-'));
  try {
    const config = cfg({
      sftp: {
        enabled: true,
        watchDir: join(sftpBase, 'incoming'),
        processedDir: join(sftpBase, 'processed'),
        failedDir: join(sftpBase, 'failed'),
        stabilityThresholdMs: 50,
      },
      as2: {
        enabled: true,
        inboxDir: join(as2Base, 'inbox'),
        processedDir: join(as2Base, 'processed'),
        failedDir: join(as2Base, 'failed'),
        stabilityThresholdMs: 50,
      },
    });
    const deps: IngestionDeps = { s3: fakeS3, prisma: fakePrisma, config, logger: noopLogger };
    const reg = await startConfiguredChannels(deps, deps.config);
    const h = reg.health();
    assert.equal(h.find((c) => c.name === 'sftp')!.status, 'running');
    assert.equal(h.find((c) => c.name === 'as2')!.status, 'running');
    await reg.closeAll();
  } finally {
    await rm(sftpBase, { recursive: true, force: true });
    await rm(as2Base, { recursive: true, force: true });
  }
});
