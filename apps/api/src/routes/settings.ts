/**
 * PS-6 — GET/PATCH /settings for tenant-level hub configuration.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ApiErrorResponse, TenantSettingsPatch, TenantSettingsResponse } from '@edi/shared';
import { requiresRole } from '../plugins/rbac.js';
import { withAudit } from '../services/audit.js';
import {
  mergeTenantSettings,
  readTenantSettings,
} from '../services/tenant-settings.js';

function readPatch(body: unknown): TenantSettingsPatch {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Request body must be an object.');
  }
  const b = body as Record<string, unknown>;
  const patch: TenantSettingsPatch = {};
  if (b.staleTrafficWindowHours !== undefined) {
    patch.staleTrafficWindowHours = Number(b.staleTrafficWindowHours);
  }
  if (typeof b.slaCountdownEnabled === 'boolean') patch.slaCountdownEnabled = b.slaCountdownEnabled;
  if (b.quietHoursStart === null || typeof b.quietHoursStart === 'string') {
    patch.quietHoursStart = b.quietHoursStart;
  }
  if (b.quietHoursEnd === null || typeof b.quietHoursEnd === 'string') {
    patch.quietHoursEnd = b.quietHoursEnd;
  }
  if (typeof b.emailDigestEnabled === 'boolean') patch.emailDigestEnabled = b.emailDigestEnabled;
  if (b.emailDigestHourUtc !== undefined) patch.emailDigestHourUtc = Number(b.emailDigestHourUtc);
  return patch;
}

export async function settingsRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get('/settings', requiresRole('viewer'), async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) {
      const body: ApiErrorResponse = { error: { code: 'NO_TENANT', message: 'No tenant context.' } };
      return reply.code(403).send(body);
    }
    const settings = await readTenantSettings(app.prisma, tenantId);
    const role = request.auth?.role ?? 'viewer';
    const response: TenantSettingsResponse = {
      settings,
      canEdit: role === 'admin',
    };
    return reply.send(response);
  });

  app.patch<{ Body: TenantSettingsPatch }>(
    '/settings',
    requiresRole('admin'),
    async (request, reply) => {
      const tenantId = request.tenantId;
      if (!tenantId) {
        const body: ApiErrorResponse = { error: { code: 'NO_TENANT', message: 'No tenant context.' } };
        return reply.code(403).send(body);
      }
      let patch: TenantSettingsPatch;
      try {
        patch = readPatch(request.body);
      } catch (e) {
        const body: ApiErrorResponse = {
          error: { code: 'BAD_REQUEST', message: e instanceof Error ? e.message : 'Invalid body.' },
        };
        return reply.code(400).send(body);
      }
      const before = await readTenantSettings(app.prisma, tenantId);
      const after = mergeTenantSettings(before, patch);
      await withAudit(
        app.prisma,
        {
          action: 'tenant.config-update',
          targetType: 'tenant',
          actorId: request.auth?.userId ?? null,
        },
        (tx) =>
          tx.tenant.update({
            where: { id: tenantId },
            data: { settings: after as never },
          }),
        () => ({ targetId: tenantId, before, after }),
      );
      const response: TenantSettingsResponse = { settings: after, canEdit: true };
      return reply.send(response);
    },
  );
}
