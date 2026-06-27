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
