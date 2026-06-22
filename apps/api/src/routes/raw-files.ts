/**
 * GET /raw-files/:id/content — stream the stored raw EDI bytes from S3, proxied
 * through the API so the bucket stays private (Gate C). Powers the raw-vs-parsed
 * toggle and raw download.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ApiErrorResponse } from '@edi/shared';
import { getObjectBuffer } from '../storage/s3.js';

import { requiresRole } from '../plugins/rbac.js';
export async function rawFileRoutes(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
  app.get<{ Params: { id: string } }>('/raw-files/:id/content', requiresRole('viewer'), async (request, reply) => {
    const row = await app.prisma.rawFile.findUnique({ where: { id: request.params.id } });
    if (!row) {
      const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'No raw file with that id.' } };
      return reply.code(404).send(body);
    }
    try {
      const bytes = await getObjectBuffer(app.s3, app.config.s3.bucket, row.s3Key);
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
}
