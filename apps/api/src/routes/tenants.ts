/**
 * Phase 10 Sprint 3.4 — Tenant self-delete.
 *
 *   DELETE /tenants/me   admin-only, scoped to the calling tenant.
 *
 * Soft-delete only — sets `Tenant.deletedAt`. The retention worker's
 * `sweepDeletedTenants` performs the actual hard-delete after a 30-day
 * grace, giving the admin a window to reverse.
 *
 * We deliberately do NOT expose DELETE /tenants/:id — cross-tenant
 * tenant deletion is an internal/support operation; intentionally not
 * a route any customer can call.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ApiErrorResponse } from '@edi/shared';
import { tenantContext } from '@edi/db';
import { requiresRole } from '../plugins/rbac.js';
import { emitAudit } from '../services/audit.js';

interface TenantDeleteRequestResponse {
  status: 'pending-hard-delete';
  /** ISO timestamp the sweeper will hard-delete after. */
  hardDeleteAfter: string;
}

const SOFT_DELETE_GRACE_DAYS = 30;

export async function tenantRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.delete('/tenants/me', requiresRole('admin'), async (request, reply) => {
    const tenantId = tenantContext.requireTenantId();
    const now = new Date();
    const hardDeleteAfter = new Date(now.getTime() + SOFT_DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000);

    // Tenant is an exempt model — the extension lets it through without
    // a context, but we use bypass() explicitly to make the cross-tenant
    // intent obvious to a future reader.
    await tenantContext.bypass(async () => {
      // Atomic: soft-delete + audit. Both commit together so a failed
      // audit insert leaves the tenant still active (the operator can
      // safely retry).
      await app.prisma.$transaction(async (tx) => {
        await tx.tenant.update({
          where: { id: tenantId },
          data: { deletedAt: now },
        });
        // emitAudit reads tenantContext.requireTenantId() — bypass would
        // make it return '<bypass>'. We pass tenantId explicitly via the
        // returned context inside `run` to keep the audit row attributed.
        await tenantContext.run({ tenantId }, async () => {
          await emitAudit(tx, {
            action: 'tenant.delete-requested',
            targetType: 'tenant',
            targetId: tenantId,
            actorId: request.auth?.userId ?? null,
            payloadDiff: { after: { deletedAt: now.toISOString(), hardDeleteAfter: hardDeleteAfter.toISOString() } },
          });
        });
      });
    });

    const body: TenantDeleteRequestResponse = {
      status: 'pending-hard-delete',
      hardDeleteAfter: hardDeleteAfter.toISOString(),
    };
    return reply.code(202).send(body);
  });

  // Cancel a pending delete — undoes the soft-delete before the sweeper runs.
  // Admin-only, scoped to the calling tenant.
  app.post('/tenants/me/undelete', requiresRole('admin'), async (request, reply) => {
    const tenantId = tenantContext.requireTenantId();

    // Lookup + decision outside any nested send paths to avoid double-reply.
    const existing = await tenantContext.bypass(async () =>
      app.prisma.tenant.findUnique({ where: { id: tenantId } }),
    );
    if (!existing) {
      // Should be unreachable — the tenant plugin already resolved this tenant.
      const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'Tenant row missing.' } };
      return reply.code(404).send(body);
    }
    if (existing.deletedAt === null) {
      // No pending delete — 204 idempotently.
      return reply.code(204).send();
    }

    await tenantContext.bypass(async () =>
      app.prisma.$transaction(async (tx) => {
        await tx.tenant.update({ where: { id: tenantId }, data: { deletedAt: null } });
        await tenantContext.run({ tenantId }, async () => {
          await emitAudit(tx, {
            action: 'tenant.delete-requested', // same verb; payloadDiff distinguishes
            targetType: 'tenant',
            targetId: tenantId,
            actorId: request.auth?.userId ?? null,
            payloadDiff: { before: { deletedAt: existing.deletedAt }, after: { deletedAt: null } },
          });
        });
      }),
    );
    return reply.code(204).send();
  });
}
