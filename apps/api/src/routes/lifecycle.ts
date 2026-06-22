/**
 * GET /lifecycle — the North Star endpoint.
 *
 *   GET /lifecycle?po=PO-12345
 *   GET /lifecycle?invoice=INV-9001     (resolves to the PO spine)
 *   GET /lifecycle?shipment=SHIP-555    (resolves to the PO spine)
 *
 * Exactly one of `po`, `invoice`, `shipment` is required. Returns the chain
 * of related EDI documents (chronological, with gaps + statuses) — see
 * `services/lifecycle.ts` for the stitching logic.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ApiErrorResponse, LifecycleResponse } from '@edi/shared';
import { tenantContext } from '@edi/db';
import { getLifecycle } from '../services/lifecycle.js';

import { requiresRole } from '../plugins/rbac.js';
export async function lifecycleRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get<{ Querystring: { po?: string; invoice?: string; shipment?: string } }>(
    '/lifecycle',
    requiresRole('viewer'),
    async (request, reply) => {
      const { po, invoice, shipment } = request.query;
      const provided = [po, invoice, shipment].filter((v) => typeof v === 'string' && v.length > 0);
      if (provided.length !== 1) {
        const body: ApiErrorResponse = {
          error: {
            code: 'INVALID_QUERY',
            message: 'Provide exactly one of ?po=, ?invoice=, or ?shipment=.',
          },
        };
        return reply.code(400).send(body);
      }

      // Phase 9 Sprint 1.4 — OUR_ISA_IDS lives on the tenant row now. Read it
      // through the active tenant context (which the tenant plugin sets per
      // request). Tenant is exempt from the extension's filter so this
      // findUnique is fine without a bypass.
      const tenantId = tenantContext.requireTenantId();
      const tenant = await app.prisma.tenant.findUnique({ where: { id: tenantId } });

      const result = await getLifecycle(
        app.prisma,
        { po, invoice, shipment },
        { ourIsaIds: tenant?.ourIsaIds ?? [] },
      );
      if (!result) {
        const body: ApiErrorResponse = {
          error: { code: 'NOT_FOUND', message: 'No PO matched the query.' },
        };
        return reply.code(404).send(body);
      }

      const body: LifecycleResponse = result;
      return reply.code(200).send(body);
    },
  );
}
