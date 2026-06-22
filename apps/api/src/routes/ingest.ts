/**
 * Ingestion + status routes.
 *
 *   POST /ingest/upload   — accept a multipart file, run it through the shared
 *                           ingestion pipeline (classify, dedup, store, record).
 *   GET  /ingest/:id      — fetch a single raw_files record.
 *   GET  /ingest          — paginated list of recent ingestions, newest first.
 *
 * The file is buffered (bounded by the multipart size limit) so the ISA control
 * number can be read for deduplication before anything is written to S3.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type {
  ApiErrorResponse,
  IngestListResponse,
  IngestUploadResponse,
  RawFileRecord,
  RawFileStatus,
  SourceChannel,
} from '@edi/shared';
import type { RawFile } from '@prisma/client';
import { ingestRawFile } from '../services/ingestion.js';

import { requiresRole } from '../plugins/rbac.js';
const STATUS_SET = new Set<RawFileStatus>([
  'RECEIVED', 'DUPLICATE', 'PARSED', 'PARSE_ERROR', 'UNRECOGNIZED_FORMAT', 'FAILED',
]);

function toRecord(row: RawFile): RawFileRecord {
  return {
    id: row.id,
    s3Key: row.s3Key,
    fileHash: row.fileHash,
    isaControlNumber: row.isaControlNumber,
    source: row.source,
    status: row.status,
    errorMessage: row.errorMessage,
    ingestedAt: row.ingestedAt.toISOString(),
  };
}

export async function ingestRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.post('/ingest/upload', requiresRole('ops'), async (request, reply) => {
    const part = await request.file();
    if (!part) {
      const body: ApiErrorResponse = { error: { code: 'NO_FILE', message: 'Expected a multipart file field.' } };
      return reply.code(400).send(body);
    }

    const content = await part.toBuffer();
    if (part.file.truncated) {
      const body: ApiErrorResponse = { error: { code: 'FILE_TOO_LARGE', message: 'File exceeds the maximum allowed size.' } };
      return reply.code(413).send(body);
    }

    const result = await ingestRawFile(
      { s3: app.s3, prisma: app.prisma, config: app.config, logger: request.log },
      { content, source: 'upload', filename: part.filename },
    );

    switch (result.outcome) {
      case 'stored':
      case 'duplicate': {
        const body: IngestUploadResponse = {
          id: result.id,
          s3Key: result.s3Key,
          status: result.status,
          fileHash: result.fileHash,
          isaControlNumber: result.isaControlNumber,
          duplicate: result.outcome === 'duplicate',
        };
        return reply.code(200).send(body);
      }
      case 'empty':
        return reply.code(400).send({ error: { code: 'EMPTY_FILE', message: result.error } } satisfies ApiErrorResponse);
      case 'storage_error':
        return reply.code(503).send({ error: { code: 'STORAGE_UNAVAILABLE', message: result.error } } satisfies ApiErrorResponse);
      case 'db_unreachable':
        return reply.code(503).send({ error: { code: 'DB_UNAVAILABLE', message: result.error } } satisfies ApiErrorResponse);
      case 'db_error':
        return reply.code(503).send({ error: { code: 'DB_WRITE_FAILED', message: result.error } } satisfies ApiErrorResponse);
    }
  });

  app.get<{ Params: { id: string } }>('/ingest/:id', requiresRole('viewer'), async (request, reply) => {
    const row = await app.prisma.rawFile.findUnique({ where: { id: request.params.id } });
    if (!row) {
      const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'No ingestion record with that id.' } };
      return reply.code(404).send(body);
    }
    return reply.code(200).send(toRecord(row));
  });

  app.get<{
    Querystring: { status?: string; source?: string; from?: string; to?: string; limit?: string; offset?: string };
  }>('/ingest', requiresRole('viewer'), async (request, reply) => {
    const q = request.query;
    const limit = Math.min(Math.max(Number.parseInt(q.limit ?? '20', 10) || 20, 1), 100);
    const offset = Math.max(Number.parseInt(q.offset ?? '0', 10) || 0, 0);

    const where: { status?: RawFileStatus; source?: SourceChannel; ingestedAt?: { gte?: Date; lte?: Date } } = {};
    if (q.status && STATUS_SET.has(q.status as RawFileStatus)) where.status = q.status as RawFileStatus;
    if (q.source === 'upload' || q.source === 'sftp') where.source = q.source;
    if (q.from || q.to) {
      where.ingestedAt = {};
      if (q.from) where.ingestedAt.gte = new Date(q.from);
      if (q.to) where.ingestedAt.lte = new Date(q.to);
    }

    const rows = await app.prisma.rawFile.findMany({ where, orderBy: { ingestedAt: 'desc' }, take: limit, skip: offset });
    const body: IngestListResponse = { items: rows.map(toRecord), limit, offset, count: rows.length };
    return reply.code(200).send(body);
  });
}
