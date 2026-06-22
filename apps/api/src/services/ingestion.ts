/**
 * Ingestion service — the single pipeline every channel funnels through.
 *
 * Both the HTTP upload endpoint and the SFTP folder-watch call `ingestRawFile`,
 * so deduplication, storage, retry, classification, and logging behave
 * identically regardless of how a file arrived.
 *
 * Pipeline:
 *   1. Reject empty input.
 *   2. Hash the bytes (SHA-256).
 *   3. Read the ISA/GS envelope. A parse failure is NOT fatal — the raw file is
 *      still stored, flagged UNRECOGNIZED_FORMAT (not X12) or PARSE_ERROR (ISA
 *      present but unparseable). The raw file is sacred.
 *   4. Probe the DB *before* touching S3 (dedup query for X12, a cheap liveness
 *      check otherwise). If the DB is down we fail fast and never write to S3.
 *   5. Store the raw bytes in S3 (with retry/backoff).
 *   6. Record the raw_files row. If this fails, the bytes are safe in S3 and we
 *      emit a reconciliation marker — a file is never silently lost.
 */
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { RawFileStatus, SourceChannel } from '@edi/shared';
import { extractEnvelopeIds, EdiParseError } from '@edi/edi-parser';
import { tenantContext } from '@edi/db';
import type { AppConfig } from '../config.js';
import { buildRawFileKey, uploadStream } from '../storage/s3.js';
import { parseAndStore } from './parsing.js';

export interface IngestionDeps {
  s3: S3Client;
  prisma: PrismaClient;
  config: AppConfig;
  logger: FastifyBaseLogger;
}

export interface IngestInput {
  content: Buffer;
  source: SourceChannel;
  /** Original filename, for logging/diagnostics only. */
  filename?: string;
}

export type IngestResult =
  | { outcome: 'stored'; id: string; s3Key: string; fileHash: string; isaControlNumber: string | null; status: RawFileStatus }
  | { outcome: 'duplicate'; id: string; s3Key: string; fileHash: string; isaControlNumber: string; status: 'DUPLICATE' }
  | { outcome: 'empty'; error: string }
  | { outcome: 'storage_error'; fileHash: string; isaControlNumber: string | null; error: string }
  | { outcome: 'db_unreachable'; fileHash: string; isaControlNumber: string | null; error: string }
  | { outcome: 'db_error'; s3Key: string; fileHash: string; isaControlNumber: string | null; error: string };

/** Classify the bytes: returns the dedup key (or null) and the row status. */
function classify(
  content: Buffer,
  logger: FastifyBaseLogger,
  ctx: { source: SourceChannel; filename?: string },
): { isaControlNumber: string | null; status: RawFileStatus; errorMessage: string | null } {
  try {
    const ids = extractEnvelopeIds(content.toString('latin1'));
    return { isaControlNumber: ids.isaControlNumber, status: 'RECEIVED', errorMessage: null };
  } catch (err) {
    if (!(err instanceof EdiParseError)) throw err;
    const status: RawFileStatus = err.kind === 'NOT_X12' ? 'UNRECOGNIZED_FORMAT' : 'PARSE_ERROR';
    logger.warn({ ...ctx, kind: err.kind, reason: err.message }, `Storing raw file flagged ${status}`);
    return { isaControlNumber: null, status, errorMessage: err.message };
  }
}

/** Heuristic: is this S3 error worth retrying (transient) vs. fatal? */
function isRetryableS3Error(err: unknown): boolean {
  const e = err as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  const status = e?.$metadata?.httpStatusCode;
  if (typeof status === 'number' && (status >= 500 || status === 429)) return true;
  const transient = new Set([
    'TimeoutError', 'RequestTimeout', 'RequestTimeoutException', 'ThrottlingException',
    'SlowDown', 'InternalError', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'NetworkingError',
  ]);
  return Boolean((e?.name && transient.has(e.name)) || (e?.code && transient.has(e.code)));
}

async function uploadWithRetry(
  deps: IngestionDeps,
  params: { key: string; body: Buffer; contentType: string },
): Promise<void> {
  const { maxAttempts, baseDelayMs } = deps.config.retry;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await uploadStream({
        client: deps.s3,
        bucket: deps.config.s3.bucket,
        key: params.key,
        body: Readable.from(params.body),
        contentType: params.contentType,
      });
      return;
    } catch (err) {
      if (attempt >= maxAttempts || !isRetryableS3Error(err)) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      deps.logger.warn({ err, key: params.key, attempt, delay }, 'Retrying S3 upload after transient error');
      await sleep(delay);
    }
  }
}

export async function ingestRawFile(deps: IngestionDeps, input: IngestInput): Promise<IngestResult> {
  const startedAt = Date.now();

  if (input.content.length === 0) {
    deps.logger.warn({ source: input.source, filename: input.filename }, 'Rejected empty file');
    return { outcome: 'empty', error: 'File is empty.' };
  }

  const fileHash = createHash('sha256').update(input.content).digest('hex');
  const { isaControlNumber, status, errorMessage } = classify(input.content, deps.logger, {
    source: input.source,
    filename: input.filename,
  });
  const baseLog = { source: input.source, filename: input.filename, fileHash, isaControlNumber, status, bytes: input.content.length };

  // --- DB probe BEFORE S3 (dedup for X12, liveness otherwise) ---
  // Guarantees that a DB outage fails fast and never orphans bytes in S3.
  try {
    if (isaControlNumber) {
      const existing = await deps.prisma.rawFile.findUnique({ where: { isaControlNumber } });
      if (existing) {
        deps.logger.info(
          { ...baseLog, outcome: 'duplicate', existingId: existing.id, durationMs: Date.now() - startedAt },
          'Duplicate interchange; skipping storage',
        );
        return { outcome: 'duplicate', id: existing.id, s3Key: existing.s3Key, fileHash, isaControlNumber, status: 'DUPLICATE' };
      }
    } else {
      await deps.prisma.rawFile.count();
    }
  } catch (err) {
    deps.logger.error({ ...baseLog, outcome: 'db_unreachable', err, durationMs: Date.now() - startedAt }, 'Database unreachable; failing before S3 write');
    return { outcome: 'db_unreachable', fileHash, isaControlNumber, error: 'Database is unavailable.' };
  }

  const id = randomUUID();
  const ingestedAt = new Date();
  const key = buildRawFileKey(id, ingestedAt);

  // --- S3 (with retry) ---
  try {
    await uploadWithRetry(deps, { key, body: input.content, contentType: 'application/edi-x12' });
  } catch (err) {
    deps.logger.error({ ...baseLog, key, outcome: 'storage_error', err, durationMs: Date.now() - startedAt }, 'S3 upload failed after retries');
    return { outcome: 'storage_error', fileHash, isaControlNumber, error: 'Failed to store the file.' };
  }

  // --- DB record ---
  try {
    // Phase 9 Sprint 1 — `tenantId` is required on every multi-tenant row.
    // The tenant extension will inject it from context if omitted, but Prisma's
    // typed CreateInput requires either the relation field (`tenant: { connect }`)
    // or the scalar (`tenantId`) at compile time. Passing the scalar matches
    // the Unchecked variant and keeps the call site explicit about what tenant
    // is being written.
    const record = await deps.prisma.rawFile.create({
      data: {
        id, s3Key: key, fileHash, isaControlNumber, source: input.source,
        status, errorMessage, ingestedAt,
        tenantId: tenantContext.requireTenantId(),
      },
    });
    deps.logger.info({ ...baseLog, key, outcome: 'stored', id: record.id, durationMs: Date.now() - startedAt }, 'File ingested');

    // Phase 2: decompose inline (Gate A). Best-effort — the raw file is already
    // safe, so a parse failure flags the row but never fails ingestion.
    let finalStatus: RawFileStatus = record.status;
    if (record.status === 'RECEIVED') {
      try {
        const parsed = await parseAndStore(deps, { rawFileId: record.id, content: input.content });
        if (parsed.outcome === 'parsed') finalStatus = parsed.status;
        else if (parsed.outcome === 'parse_error') finalStatus = 'PARSE_ERROR';
      } catch (err) {
        deps.logger.error({ err, rawFileId: record.id }, 'Inline parse threw (raw file is safe)');
      }
    }
    return { outcome: 'stored', id: record.id, s3Key: record.s3Key, fileHash, isaControlNumber, status: finalStatus };
  } catch (err) {
    deps.logger.error(
      { ...baseLog, key, outcome: 'db_error', marker: 'NEEDS_DB_RECONCILIATION', err, durationMs: Date.now() - startedAt },
      'DB write failed after successful S3 upload',
    );
    return { outcome: 'db_error', s3Key: key, fileHash, isaControlNumber, error: 'File stored but could not be recorded.' };
  }
}
