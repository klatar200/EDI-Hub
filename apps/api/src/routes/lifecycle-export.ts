/**
 * PS-9/PS-11 — lifecycle export routes.
 *   GET  /lifecycles/:po/export?format=txt|csv|pdf  — single PO (F34)
 *   POST /lifecycles/export                         — bulk CSV manifest (F57)
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ApiErrorResponse, LifecycleBulkExportInput } from '@edi/shared';
import { requiresRole } from '../plugins/rbac.js';
import { getLifecycle, summarizeLifecycleEvents } from '../services/lifecycle.js';
import { lifecycleToCsv, lifecycleToPdf, lifecycleToTxt } from '../services/lifecycle-export-format.js';
import { buildLifecycleExportZip } from '../services/lifecycle-export-zip.js';
import { tenantContext } from '@edi/db';

/** Maximum POs per bulk export request (CSV or ZIP). */
export const MAX_BULK_EXPORT_POS = 50;

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
  app.get<{ Params: { po: string }; Querystring: { format?: string } }>(
    '/lifecycles/:po/export',
    requiresRole('viewer'),
    async (request, reply) => {
      const format = (request.query.format ?? 'txt').toLowerCase();
      if (!['txt', 'csv', 'pdf'].includes(format)) {
        const body: ApiErrorResponse = { error: { code: 'BAD_REQUEST', message: 'format must be txt, csv, or pdf.' } };
        return reply.code(400).send(body);
      }
      const tenantId = tenantContext.requireTenantId();
      const tenant = await app.prisma.tenant.findUnique({ where: { id: tenantId } });
      const lc = await getLifecycle(app.prisma, { po: request.params.po }, { ourIsaIds: tenant?.ourIsaIds ?? [] });
      if (!lc) {
        const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'No PO matched the query.' } };
        return reply.code(404).send(body);
      }
      const safePo = request.params.po.replace(/[^\w.-]+/g, '_');
      if (format === 'txt') {
        return reply
          .header('Content-Type', 'text/plain; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="lifecycle-${safePo}.txt"`)
          .send(lifecycleToTxt(lc));
      }
      if (format === 'csv') {
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="lifecycle-${safePo}.csv"`)
          .send(lifecycleToCsv(lc));
      }
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="lifecycle-${safePo}.pdf"`)
        .send(lifecycleToPdf(lc));
    },
  );

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
      if (pos.length > MAX_BULK_EXPORT_POS) {
        const body: ApiErrorResponse = {
          error: {
            code: 'BAD_REQUEST',
            message: `Export is limited to ${MAX_BULK_EXPORT_POS} POs per request.`,
          },
        };
        return reply.code(400).send(body);
      }
      const tenant = request.tenantId
        ? await app.prisma.tenant.findUnique({
            where: { id: request.tenantId },
            select: { ourIsaIds: true },
          })
        : null;
      const ourIsaIds = tenant?.ourIsaIds ?? [];
      const exportFormat = request.body?.format === 'zip' ? 'zip' : 'csv';

      if (exportFormat === 'zip') {
        const include = request.body?.includeFormats?.length
          ? request.body.includeFormats.filter((f): f is 'txt' | 'csv' | 'pdf' => f === 'txt' || f === 'csv' || f === 'pdf')
          : (['txt', 'csv', 'pdf'] as const);
        const zip = await buildLifecycleExportZip({
          prisma: app.prisma,
          pos,
          ourIsaIds,
          formats: [...include],
          includeRaw: request.body?.includeRaw === true,
          storage: app.storage,
        });
        return reply
          .header('Content-Type', 'application/zip')
          .header('Content-Disposition', 'attachment; filename="lifecycles-export.zip"')
          .send(zip);
      }

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
