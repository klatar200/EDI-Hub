/**
 * PS-3 — GET /dashboard ops home aggregates.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ApiErrorResponse, DashboardIngestWindow, DashboardResponse } from '@edi/shared';
import { tenantContext } from '@edi/db';
import { getDashboard } from '../services/dashboard.js';
import { requiresRole } from '../plugins/rbac.js';

const INGEST_WINDOWS = new Set<DashboardIngestWindow>(['24h', '7d', '30d', 'all']);

export async function dashboardRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get<{ Querystring: { ingestWindow?: string; rejectionWindowDays?: string } }>(
    '/dashboard',
    requiresRole('viewer'),
    async (request, reply) => {
      const ingestWindow = request.query.ingestWindow;
      const rejectionDays = Number.parseInt(request.query.rejectionWindowDays ?? '7', 10);

      if (ingestWindow && !INGEST_WINDOWS.has(ingestWindow as DashboardIngestWindow)) {
        const body: ApiErrorResponse = {
          error: { code: 'INVALID_QUERY', message: 'ingestWindow must be 24h, 7d, 30d, or all.' },
        };
        return reply.code(400).send(body);
      }
      if (rejectionDays !== 7 && rejectionDays !== 30) {
        const body: ApiErrorResponse = {
          error: { code: 'INVALID_QUERY', message: 'rejectionWindowDays must be 7 or 30.' },
        };
        return reply.code(400).send(body);
      }

      const tenantId = tenantContext.requireTenantId();
      const tenant = await app.prisma.tenant.findUnique({ where: { id: tenantId } });

      const result = await getDashboard(app.prisma, {
        ingestWindow: (ingestWindow as DashboardIngestWindow | undefined) ?? '24h',
        rejectionWindowDays: rejectionDays as 7 | 30,
        ourIsaIds: tenant?.ourIsaIds ?? app.config.ourIsaIds,
      });

      const body: DashboardResponse = result;
      return reply.code(200).send(body);
    },
  );
}
