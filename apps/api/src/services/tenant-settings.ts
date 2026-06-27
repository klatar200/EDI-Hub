/**
 * PS-6 — Tenant settings read/write with Zod validation.
 */
import type { PrismaClient } from '@prisma/client';
import type { TenantSettings, TenantSettingsPatch } from '@edi/shared';

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  staleTrafficWindowHours: 6,
  slaCountdownEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  emailDigestEnabled: false,
  emailDigestHourUtc: 8,
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseTenantSettings(raw: unknown): TenantSettings {
  const base = { ...DEFAULT_TENANT_SETTINGS };
  if (!isObject(raw)) return base;
  const hours = Number(raw.staleTrafficWindowHours);
  if (Number.isFinite(hours) && hours >= 1 && hours <= 168) {
    base.staleTrafficWindowHours = Math.floor(hours);
  }
  if (typeof raw.slaCountdownEnabled === 'boolean') {
    base.slaCountdownEnabled = raw.slaCountdownEnabled;
  }
  if (raw.quietHoursStart === null || typeof raw.quietHoursStart === 'string') {
    base.quietHoursStart = raw.quietHoursStart ?? null;
  }
  if (raw.quietHoursEnd === null || typeof raw.quietHoursEnd === 'string') {
    base.quietHoursEnd = raw.quietHoursEnd ?? null;
  }
  if (typeof raw.emailDigestEnabled === 'boolean') {
    base.emailDigestEnabled = raw.emailDigestEnabled;
  }
  const digestHour = Number(raw.emailDigestHourUtc);
  if (Number.isFinite(digestHour) && digestHour >= 0 && digestHour <= 23) {
    base.emailDigestHourUtc = Math.floor(digestHour);
  }
  return base;
}

export function mergeTenantSettings(
  current: TenantSettings,
  patch: TenantSettingsPatch,
): TenantSettings {
  return parseTenantSettings({ ...current, ...patch });
}

export async function readTenantSettings(
  prisma: PrismaClient,
  tenantId: string,
): Promise<TenantSettings> {
  const row = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  return parseTenantSettings(row?.settings);
}
