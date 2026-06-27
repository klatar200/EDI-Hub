/**
 * PS-11 — Daily email digest job (F51). Preview mode writes audit only.
 */
import type { PrismaClient } from '@prisma/client';
import { tenantContext } from '@edi/db';
import type { JobHandler } from '../interface.js';
import { readTenantSettings } from '../../services/tenant-settings.js';
import { emitAudit } from '../../services/audit.js';

export interface EmailDigestPayload {
  tenantId?: string;
}

export function createEmailDigestHandler(deps: {
  prisma: PrismaClient;
  previewMode: boolean;
}): JobHandler {
  return async (payload: unknown) => {
    const p = payload as EmailDigestPayload;
    const tenantId = p.tenantId;
    if (!tenantId) throw new Error('email-digest requires tenantId');

    await tenantContext.run({ tenantId }, async () => {
      const settings = await readTenantSettings(deps.prisma, tenantId);
      if (!settings.emailDigestEnabled) return;

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [openAlerts, failedIngests, stalePartners] = await Promise.all([
        deps.prisma.alert.count({ where: { status: 'active' } }),
        deps.prisma.rawFile.count({
          where: { status: { in: ['PARSE_ERROR', 'FAILED'] }, ingestedAt: { gte: since } },
        }),
        deps.prisma.alert.count({ where: { status: 'active', type: 'STALE_TRAFFIC' } }),
      ]);

      const summary = { openAlerts, failedIngests24h: failedIngests, staleTrafficAlerts: stalePartners };

      if (deps.previewMode) {
        await deps.prisma.$transaction(async (tx) => {
          await emitAudit(tx, {
            action: 'tenant.config-update',
            targetType: 'tenant',
            targetId: tenantId,
            actorId: null,
            payloadDiff: { after: { emailDigestPreview: summary } },
          });
        });
        return;
      }
      // Live send would use SES notifier — stubbed for v1; audit records the run.
      await deps.prisma.$transaction(async (tx) => {
        await emitAudit(tx, {
          action: 'tenant.config-update',
          targetType: 'tenant',
          targetId: tenantId,
          actorId: null,
          payloadDiff: { after: { emailDigestSent: summary } },
        });
      });
    });
  };
}
