/**
 * Phase 7 Sprint 1 — alerts service.
 *
 * `createAlert` is idempotent on `dedupeKey`: detection reruns update an
 * existing row's `lastSeenAt` instead of inserting duplicates.
 *
 * The detector calls this; the route layer never inserts directly.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { tenantContext } from '@edi/db';
import type {
  AlertFilters,
  AlertRecord,
  AlertSeverity,
  AlertStatus,
  AlertType,
} from '@edi/shared';

interface DbAlertRow {
  id: string;
  partnerId: string | null;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  dedupeKey: string;
  sourceRef: unknown;
  status: AlertStatus;
  createdAt: Date;
  lastSeenAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  suppressUntil: Date | null;
}

function readSourceRef(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

export function toRecord(row: DbAlertRow): AlertRecord {
  return {
    id: row.id,
    partnerId: row.partnerId,
    type: row.type,
    severity: row.severity,
    title: row.title,
    body: row.body,
    dedupeKey: row.dedupeKey,
    sourceRef: readSourceRef(row.sourceRef),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    acknowledgedBy: row.acknowledgedBy,
    suppressUntil: row.suppressUntil ? row.suppressUntil.toISOString() : null,
  };
}

export interface CreateAlertInput {
  partnerId: string | null;
  type: AlertType;
  severity?: AlertSeverity;
  title: string;
  body: string;
  /** Stable key — detection reruns with the same key bump lastSeenAt. */
  dedupeKey: string;
  sourceRef?: Record<string, unknown>;
  /** Detection's notion of "now" — exposed so tests can time-travel. */
  now?: Date;
  /** Phase 7 Sprint 3 — on a brand-new alert, set suppressUntil to this
   *  time so reruns inside the window don't re-notify. Ignored when the
   *  alert already exists (preserves any manual snooze). */
  suppressUntil?: Date | null;
}

export type CreateAlertOutcome = 'created' | 'reactivated' | 'updated';

export interface CreateAlertResult {
  alert: AlertRecord;
  outcome: CreateAlertOutcome;
}

/**
 * Upsert on dedupeKey.
 *
 * Outcome reflects what happened: `created` for a brand-new row,
 * `reactivated` when an acknowledged/resolved row flipped back to active
 * because suppression expired, and `updated` when an existing active row's
 * lastSeenAt is just being bumped. Phase 7 Sprint 2's notifier only fires on
 * `created` / `reactivated` so steady-state noise stays low.
 *
 * If a row with this dedupeKey is already `acknowledged`/`resolved` AND its
 * `suppressUntil` has expired, status flips back to `active`. If
 * `suppressUntil` is in the future, lastSeenAt bumps but status stays.
 */
export async function createAlert(
  prisma: PrismaClient,
  input: CreateAlertInput,
): Promise<CreateAlertResult> {
  const now = input.now ?? new Date();
  const existing = (await prisma.alert.findUnique({
    where: { dedupeKey: input.dedupeKey },
  })) as unknown as DbAlertRow | null;

  if (existing) {
    const reactivate =
      (existing.status === 'acknowledged' || existing.status === 'resolved') &&
      (!existing.suppressUntil || existing.suppressUntil.getTime() <= now.getTime());
    const updated = (await prisma.alert.update({
      where: { dedupeKey: input.dedupeKey },
      data: {
        lastSeenAt: now,
        title: input.title,
        body: input.body,
        severity: input.severity ?? existing.severity,
        sourceRef: (input.sourceRef ?? {}) as Prisma.InputJsonValue,
        status: reactivate ? 'active' : existing.status,
        acknowledgedAt: reactivate ? null : existing.acknowledgedAt,
        acknowledgedBy: reactivate ? null : existing.acknowledgedBy,
      },
    })) as unknown as DbAlertRow;
    return { alert: toRecord(updated), outcome: reactivate ? 'reactivated' : 'updated' };
  }

  const created = (await prisma.alert.create({
    data: {
      // Phase 9 Sprint 1 — alerts are tenant-scoped. Detection runs inside a
      // tenant context (set by the run-detection script or, future, per-tenant
      // scheduler). The tenant extension also auto-injects, but Prisma's
      // typed CreateInput needs the scalar at compile time.
      tenantId: tenantContext.requireTenantId(),
      partnerId: input.partnerId,
      type: input.type,
      severity: input.severity ?? 'warning',
      title: input.title,
      body: input.body,
      dedupeKey: input.dedupeKey,
      sourceRef: (input.sourceRef ?? {}) as Prisma.InputJsonValue,
      createdAt: now,
      lastSeenAt: now,
      suppressUntil: input.suppressUntil ?? null,
    },
  })) as unknown as DbAlertRow;
  return { alert: toRecord(created), outcome: 'created' };
}

/** Phase 7 Sprint 3 — snooze an alert for N minutes without changing status. */
export async function snoozeAlert(
  prisma: PrismaClient,
  id: string,
  minutes: number,
  now: Date = new Date(),
): Promise<AlertRecord | null> {
  const existing = await prisma.alert.findUnique({ where: { id } });
  if (!existing) return null;
  const until = new Date(now.getTime() + Math.max(1, Math.floor(minutes)) * 60 * 1000);
  const updated = (await prisma.alert.update({
    where: { id },
    data: { suppressUntil: until, lastSeenAt: now },
  })) as unknown as DbAlertRow;
  return toRecord(updated);
}

/** Maximum alerts returned in a single list query. */
export const MAX_LIST_ALERTS = 500;

export async function listAlerts(
  prisma: PrismaClient,
  filters: AlertFilters = {},
): Promise<AlertRecord[]> {
  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;
  if (filters.partnerId) where.partnerId = filters.partnerId;
  if (filters.partnerName) {
    const needle = filters.partnerName.trim().toLowerCase();
    const partners = await prisma.tradingPartner.findMany({
      where: { displayName: { contains: filters.partnerName, mode: 'insensitive' } },
      select: { id: true, displayName: true },
    });
    const ids = partners
      .filter((p) => p.displayName.toLowerCase().includes(needle))
      .map((p) => p.id);
    where.partnerId = { in: ids.length > 0 ? ids : ['__none__'] };
  }
  if (filters.from || filters.to) {
    const range: { gte?: Date; lte?: Date } = {};
    if (filters.from) range.gte = new Date(filters.from);
    if (filters.to) range.lte = new Date(filters.to);
    where.createdAt = range;
  }
  const rows = (await prisma.alert.findMany({
    where,
    orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
    take: MAX_LIST_ALERTS,
  })) as unknown as DbAlertRow[];
  return rows.map(toRecord);
}

export async function getAlert(
  prisma: PrismaClient,
  id: string,
): Promise<AlertRecord | null> {
  const row = (await prisma.alert.findUnique({ where: { id } })) as unknown as DbAlertRow | null;
  return row ? toRecord(row) : null;
}

/** PS-4 — ack all active alerts for a partner (by id or display name). */
export async function bulkAcknowledgeAlerts(
  prisma: PrismaClient,
  input: { who: string; partnerId?: string; partnerName?: string },
  suppressMinutes = 60,
  now: Date = new Date(),
): Promise<number> {
  const filters: AlertFilters = { status: 'active' };
  if (input.partnerId) filters.partnerId = input.partnerId;
  if (input.partnerName) filters.partnerName = input.partnerName;
  const items = await listAlerts(prisma, filters);
  let count = 0;
  for (const a of items) {
    const ok = await acknowledgeAlert(prisma, a.id, input.who, now, suppressMinutes);
    if (ok) count += 1;
  }
  return count;
}

export async function acknowledgeAlert(
  prisma: PrismaClient,
  id: string,
  who: string,
  now: Date = new Date(),
  suppressMinutes = 60,
): Promise<AlertRecord | null> {
  const existing = await prisma.alert.findUnique({ where: { id } });
  if (!existing) return null;
  const suppressUntil = new Date(now.getTime() + Math.max(1, Math.floor(suppressMinutes)) * 60 * 1000);
  const updated = (await prisma.alert.update({
    where: { id },
    data: {
      status: 'acknowledged',
      acknowledgedAt: now,
      acknowledgedBy: who,
      suppressUntil,
    },
  })) as unknown as DbAlertRow;
  return toRecord(updated);
}
