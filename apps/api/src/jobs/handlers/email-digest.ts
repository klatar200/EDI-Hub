/**
 * PS-11 — Daily email digest job (F51). Preview mode writes audit only.
 */
import type { PrismaClient } from '@prisma/client';
import { tenantContext } from '@edi/db';
import type { JobHandler } from '../interface.js';
import { readTenantSettings } from '../../services/tenant-settings.js';
import { emitAudit } from '../../services/audit.js';
import { msUntilDigestHour } from '../email-digest-schedule.js';

export const EMAIL_DIGEST_JOB_NAME = 'email-digest';

export interface EmailDigestPayload {
  tenantId?: string;
}

export function createEmailDigestHandler(deps: {
  prisma: PrismaClient;
  previewMode: boolean;
  scheduleNext?: (tenantId: string, hourUtc: number) => Promise<void>;
}): JobHandler {
  return async (payload: unknown) => {
    const p = payload as EmailDigestPayload;
    const tenantId = p.tenantId;
    if (!tenantId) throw new Error('email-digest requires tenantId');

    await tenantContext.run({ tenantId }, async () => {
      const settings = await readTenantSettings(deps.prisma, tenantId);
      if (!settings.emailDigestEnabled) return;

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [openAlerts, failedIngests, stalePartners, unknownIsaAlerts] = await Promise.all([
        deps.prisma.alert.count({ where: { status: 'active' } }),
        deps.prisma.rawFile.count({
          where: { status: { in: ['PARSE_ERROR', 'FAILED'] }, ingestedAt: { gte: since } },
        }),
        deps.prisma.alert.count({ where: { status: 'active', type: 'STALE_TRAFFIC' } }),
        deps.prisma.alert.count({ where: { status: 'active', type: 'UNKNOWN_ISA' } }),
      ]);

      const summary = {
        openAlerts,
        failedIngests24h: failedIngests,
        staleTrafficAlerts: stalePartners,
        unknownIsaAlerts,
      };

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
      } else {
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
      }

      if (deps.scheduleNext) {
        await deps.scheduleNext(tenantId, settings.emailDigestHourUtc);
      }
    });
  };
}

export async function scheduleEmailDigestForTenant(
  enqueue: (payload: EmailDigestPayload, delayMs: number) => Promise<void>,
  tenantId: string,
  hourUtc: number,
): Promise<void> {
  await enqueue({ tenantId }, msUntilDigestHour(hourUtc));
}

export async function bootstrapEmailDigestSchedules(
  prisma: PrismaClient,
  enqueue: (payload: EmailDigestPayload, delayMs: number) => Promise<void>,
): Promise<void> {
  const { tenantContext } = await import('@edi/db');
  const { parseTenantSettings } = await import('../../services/tenant-settings.js');
  await tenantContext.bypass(async () => {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true, settings: true },
    });
    for (const tenant of tenants) {
      const settings = parseTenantSettings(tenant.settings);
      if (!settings.emailDigestEnabled) continue;
      await scheduleEmailDigestForTenant(enqueue, tenant.id, settings.emailDigestHourUtc);
    }
  });
}
