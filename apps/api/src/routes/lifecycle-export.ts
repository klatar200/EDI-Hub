/**
 * PS-11 — POST /lifecycles/export — bulk CSV manifest for selected POs.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ApiErrorResponse, LifecycleBulkExportInput } from '@edi/shared';
import { requiresRole } from '../plugins/rbac.js';
import { getLifecycle, summarizeLifecycleEvents } from '../services/lifecycle.js';

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export async function lifecycleExportRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.post<{ Body: LifecycleBulkExportInput }>(
    '/lifecycles/export',
    requiresRole('viewer'),
    async (request, reply) => {
      const pos = Array.isArray(request.body?.pos)
        ? request.body.pos.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        : [];
      if (pos.length === 0) {
        const body: ApiErrorResponse = { error: { code: 'BAD_REQUEST', message: 'Provide at least one PO.' } };
        return reply.code(400).send(body);
      }
      const tenant = request.tenantId
        ? await app.prisma.tenant.findUnique({
            where: { id: request.tenantId },
            select: { ourIsaIds: true },
          })
        : null;
      const ourIsaIds = tenant?.ourIsaIds ?? [];
      const headers = [
        'po',
        'partner',
        'flow',
        'received',
        'missing',
        'rejected',
        'hasDuplicates',
      ];
      const lines = [headers.join(',')];
      for (const po of pos) {
        const lc = await getLifecycle(app.prisma, { po }, { ourIsaIds });
        if (!lc) continue;
        const counts = summarizeLifecycleEvents(lc.events);
        lines.push(
          [
            csvEscape(po),
            csvEscape(lc.partner?.displayName ?? ''),
            csvEscape(lc.flow),
            String(counts.received),
            String(counts.missing),
            String(counts.rejected),
            String(counts.hasDuplicates),
          ].join(','),
        );
      }
      const csv = lines.join('\n');
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="lifecycles-export.csv"')
        .send(csv);
    },
  );
}
