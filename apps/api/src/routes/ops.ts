/**
 * PS-4 — ops triggers (run detection on demand).
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { tenantContext } from '@edi/db';
import { runDetectionPass } from '../jobs/handlers/detection.js';
import { requiresRole } from '../plugins/rbac.js';

export async function opsRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.post('/ops/detect', requiresRole('ops'), async (request, reply) => {
    const tenantId = tenantContext.requireTenantId();
    const result = await runDetectionPass(
      {
        prisma: app.prisma,
        notifier: { prisma: app.prisma, config: app.config.notifier },
        suppressionMinutes: app.config.alertSuppressionMinutes,
        logger: request.log,
      },
      { tenantId },
    );
    return reply.code(200).send({ ok: true, result });
  });
}
