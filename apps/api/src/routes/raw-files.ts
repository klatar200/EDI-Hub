/**
 * GET /raw-files/:id/content — stream the stored raw EDI bytes from S3, proxied
 * through the API so the bucket stays private (Gate C). Powers the raw-vs-parsed
 * toggle and raw download.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ApiErrorResponse, RawFileRecord } from '@edi/shared';
import { withAudit } from '../services/audit.js';
import { reparseRawFile } from '../services/parsing.js';

import { requiresRole } from '../plugins/rbac.js';
export async function rawFileRoutes(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/raw-files/:id/export',
    requiresRole('viewer'),
    async (request, reply) => {
      const row = await app.prisma.rawFile.findUnique({ where: { id: request.params.id } });
      if (!row) {
        const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'No raw file with that id.' } };
        return reply.code(404).send(body);
      }
      const format = (request.query.format ?? 'txt').toLowerCase();
      if (!['txt', 'csv', 'pdf'].includes(format)) {
        const body: ApiErrorResponse = { error: { code: 'BAD_REQUEST', message: 'format must be txt, csv, or pdf.' } };
        return reply.code(400).send(body);
      }
      try {
        const bytes = await app.storage.download(row.s3Key);
        const text = bytes.toString('utf8');
        if (format === 'txt') {
          return reply
            .header('Content-Type', 'text/plain; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="${row.id}.edi.txt"`)
            .send(text);
        }
        if (format === 'csv') {
          const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
          const csv = ['segment', 'content', ...lines.map((l, i) => `${i + 1},"${l.replace(/"/g, '""')}"`)].join('\n');
          return reply
            .header('Content-Type', 'text/csv; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="${row.id}.edi.csv"`)
            .send(csv);
        }
        const pdfBody = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R>>endobj\n4 0 obj<</Length ${text.length + 50}>>stream\nBT /F1 10 Tf 50 750 Td (${text.slice(0, 500).replace(/[()\\]/g, ' ')}) Tj ET\nendstream endobj\nxref\n0 5\ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n0\n%%EOF`;
        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', `attachment; filename="${row.id}.edi.pdf"`)
          .send(Buffer.from(pdfBody));
      } catch (err) {
        request.log.error({ err, id: row.id }, 'Failed to export raw file');
        const body: ApiErrorResponse = { error: { code: 'STORAGE_UNAVAILABLE', message: 'Could not export the raw file.' } };
        return reply.code(503).send(body);
      }
    },
  );

  app.get<{ Params: { id: string } }>('/raw-files/:id/content', requiresRole('viewer'), async (request, reply) => {
    const row = await app.prisma.rawFile.findUnique({ where: { id: request.params.id } });
    if (!row) {
      const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'No raw file with that id.' } };
      return reply.code(404).send(body);
    }
    try {
      const bytes = await app.storage.download(row.s3Key);
      return reply
        .header('content-type', 'application/edi-x12')
        .header('content-disposition', `inline; filename="${row.id}.edi"`)
        .send(bytes);
    } catch (err) {
      request.log.error({ err, id: row.id, key: row.s3Key }, 'Failed to read raw bytes from S3');
      const body: ApiErrorResponse = { error: { code: 'STORAGE_UNAVAILABLE', message: 'Could not read the raw file.' } };
      return reply.code(503).send(body);
    }
  });

  app.post<{ Params: { id: string } }>(
    '/raw-files/:id/reparse',
    requiresRole('ops'),
    async (request, reply) => {
      const existing = await app.prisma.rawFile.findUnique({ where: { id: request.params.id } });
      if (!existing) {
        const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'No raw file with that id.' } };
        return reply.code(404).send(body);
      }
      const deps = {
        s3: app.s3,
        storage: app.storage,
        prisma: app.prisma,
        config: app.config,
        logger: request.log,
      };
      const result = await withAudit(
        app.prisma,
        {
          action: 'rawFile.reparse',
          targetType: 'rawFile',
          actorId: request.auth?.userId ?? null,
        },
        async (tx) => {
          const outcome = await reparseRawFile({ ...deps, prisma: tx as typeof app.prisma }, request.params.id);
          const row = await tx.rawFile.findUnique({ where: { id: request.params.id } });
          return { outcome, row };
        },
        (r) => ({ targetId: request.params.id, after: r.row }),
      ) as { outcome: unknown; row: typeof existing | null };
      if (!result.row) {
        const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'No raw file with that id.' } };
        return reply.code(404).send(body);
      }
      const body: RawFileRecord = {
        id: result.row.id,
        s3Key: result.row.s3Key,
        fileHash: result.row.fileHash,
        isaControlNumber: result.row.isaControlNumber,
        source: result.row.source,
        status: result.row.status,
        errorMessage: result.row.errorMessage,
        ingestedAt: result.row.ingestedAt.toISOString(),
      };
      return reply.code(200).send({ rawFile: body, parse: result.outcome });
    },
  );
}
