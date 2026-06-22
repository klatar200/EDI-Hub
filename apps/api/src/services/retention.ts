/**
 * Phase 10 Sprint 3 — Data retention worker.
 *
 * Sweeps once per day (or invoked manually via apps/api/src/scripts/run-retention.ts).
 * For every tenant, reads `tenant.retention` and deletes / archives rows
 * that have aged past their per-category TTL.
 *
 * Categories:
 *   - rawFiles    — flips status to ARCHIVED (preserves lineage; S3 object
 *                   removal is a separate concern handled by the S3 lifecycle
 *                   rule in infra/s3.tf and an explicit `deleteObject` in
 *                   the archive step below).
 *   - parsedTree  — deletes interchanges, which cascade-delete every
 *                   functional group / transaction / segment / element.
 *   - auditEvents — deletes audit rows past TTL. The worker's own
 *                   `retention.run` audit is well within TTL.
 *   - alerts      — deletes alert rows past TTL.
 *
 * TTL of 0 means "disabled for this category" — used by tenants on a
 * regulatory schedule that need to keep audit data forever.
 *
 * The worker also runs the tenant hard-delete sweeper: any tenant with
 * `deletedAt` older than 30 days has its data hard-deleted in dependency
 * order, then the Tenant row itself.
 */
import type { PrismaClient } from '@prisma/client';
import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { tenantContext } from '@edi/db';
import { emitAudit } from './audit.js';

/** Per-category counts surfaced in the `retention.run` audit row. */
export interface RetentionCounts {
  rawFilesArchived: number;
  parsedInterchangesDeleted: number;
  auditEventsDeleted: number;
  alertsDeleted: number;
}

/** Tenant-deletion sweeper outcome — included in the `tenant.hard-deleted` audit row. */
export interface TenantHardDeleteCounts {
  tradingPartners: number;
  rawFiles: number;
  interchanges: number;
  alerts: number;
  auditEvents: number;
  users: number;
}

interface TenantRow {
  id: string;
  retention: unknown;
  deletedAt: Date | null;
}

interface RetentionPolicy {
  rawFiles: number;
  parsedTree: number;
  auditEvents: number;
  alerts: number;
}

const DEFAULT_POLICY: RetentionPolicy = {
  rawFiles: 540,
  parsedTree: 540,
  auditEvents: 365,
  alerts: 365,
};

function readPolicy(raw: unknown): RetentionPolicy {
  if (raw == null || typeof raw !== 'object') return DEFAULT_POLICY;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
  return {
    rawFiles: num(r.rawFiles, DEFAULT_POLICY.rawFiles),
    parsedTree: num(r.parsedTree, DEFAULT_POLICY.parsedTree),
    auditEvents: num(r.auditEvents, DEFAULT_POLICY.auditEvents),
    alerts: num(r.alerts, DEFAULT_POLICY.alerts),
  };
}

function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export interface RetentionDeps {
  prisma: PrismaClient;
  /** Optional — used to delete the underlying S3 object when a raw file
   *  is archived. Tests inject a fake; if omitted, the worker only flips
   *  the DB row and the S3 lifecycle rule handles the object expiry. */
  s3?: S3Client;
  /** Bucket name for the raw-files objects. Required when `s3` is passed. */
  s3Bucket?: string;
}

/**
 * Run one pass of the retention worker across every active tenant.
 * Returns the per-tenant counts so the caller (script / scheduler /
 * test) can log a summary.
 *
 * Idempotent: a second consecutive run with the same `now` deletes
 * zero additional rows.
 */
export async function runRetention(
  deps: RetentionDeps,
  now: Date = new Date(),
): Promise<Map<string, RetentionCounts>> {
  // tenant.findMany is exempt-table; the extension lets it through inside
  // a bypass context. We need every active (non-deleted) tenant.
  const tenants = (await tenantContext.bypass(async () =>
    deps.prisma.tenant.findMany({ where: { deletedAt: null } }),
  )) as unknown as TenantRow[];

  const results = new Map<string, RetentionCounts>();

  for (const tenant of tenants) {
    const policy = readPolicy(tenant.retention);
    const counts: RetentionCounts = {
      rawFilesArchived: 0,
      parsedInterchangesDeleted: 0,
      auditEventsDeleted: 0,
      alertsDeleted: 0,
    };

    await tenantContext.run({ tenantId: tenant.id }, async () => {
      // 1) Raw files past TTL → ARCHIVED. Read the S3 keys first so we
      // can drop the objects before flipping status (so a crashed worker
      // never leaves orphan objects behind).
      if (policy.rawFiles > 0) {
        const cut = cutoff(now, policy.rawFiles);
        const stale = (await deps.prisma.rawFile.findMany({
          where: { ingestedAt: { lt: cut }, status: { not: 'ARCHIVED' } },
          select: { id: true, s3Key: true },
        })) as unknown as Array<{ id: string; s3Key: string }>;

        for (const row of stale) {
          if (deps.s3 && deps.s3Bucket) {
            try {
              await deps.s3.send(new DeleteObjectCommand({
                Bucket: deps.s3Bucket,
                Key: row.s3Key,
              }));
            } catch {
              // S3 lifecycle rule is the backstop; an error here doesn't
              // prevent the DB flip. The next run will retry if the row
              // is still non-ARCHIVED (which it would be on flip-failure).
            }
          }
          await deps.prisma.rawFile.update({
            where: { id: row.id },
            data: { status: 'ARCHIVED' },
          });
          counts.rawFilesArchived += 1;
        }
      }

      // 2) Parsed tree (interchanges + descendants) past TTL.
      // FunctionalGroup / Transaction / Segment / Element are cascade-deleted
      // because the schema declares onDelete: Cascade on their parent FKs.
      if (policy.parsedTree > 0) {
        const cut = cutoff(now, policy.parsedTree);
        const result = await deps.prisma.interchange.deleteMany({
          where: { parsedAt: { lt: cut } },
        });
        counts.parsedInterchangesDeleted = result.count;
      }

      // 3) Audit events past TTL.
      if (policy.auditEvents > 0) {
        const cut = cutoff(now, policy.auditEvents);
        const result = await deps.prisma.auditEvent.deleteMany({
          where: { createdAt: { lt: cut } },
        });
        counts.auditEventsDeleted = result.count;
      }

      // 4) Alerts past TTL.
      if (policy.alerts > 0) {
        const cut = cutoff(now, policy.alerts);
        const result = await deps.prisma.alert.deleteMany({
          where: { createdAt: { lt: cut } },
        });
        counts.alertsDeleted = result.count;
      }

      // 5) Emit a single retention.run audit row summarising the sweep.
      // Writing this AFTER the deletes means a partial-failure leaves
      // no misleading "all clear" audit row.
      await emitAudit(deps.prisma, {
        action: 'retention.run',
        targetType: 'system',
        targetId: tenant.id,
        actorId: null, // system-driven, no user attribution
        payloadDiff: { after: counts },
      });
    });

    results.set(tenant.id, counts);
  }

  return results;
}

/**
 * Sweep tenants whose soft-delete grace period has expired. Hard-deletes
 * everything tenant-scoped + the Tenant row itself. Returns per-tenant
 * counts.
 *
 * Runs inside `tenantContext.bypass` because deleting across tenants is
 * an admin/system operation by definition.
 */
export async function sweepDeletedTenants(
  prisma: PrismaClient,
  now: Date = new Date(),
  graceDays = 30,
): Promise<Map<string, TenantHardDeleteCounts>> {
  const cut = cutoff(now, graceDays);
  const due = (await tenantContext.bypass(async () =>
    prisma.tenant.findMany({ where: { deletedAt: { lt: cut } } }),
  )) as unknown as Array<{ id: string }>;

  const results = new Map<string, TenantHardDeleteCounts>();

  for (const tenant of due) {
    const counts: TenantHardDeleteCounts = {
      tradingPartners: 0, rawFiles: 0, interchanges: 0,
      alerts: 0, auditEvents: 0, users: 0,
    };

    // Bypass is required because we're crossing the tenant boundary —
    // the row we're about to delete is the tenant context itself.
    await tenantContext.bypass(async () => {
      // Delete in dependency order — leaf rows first so FK constraints
      // don't reject the parent delete. Children of Interchange cascade
      // automatically via onDelete: Cascade in the schema.
      counts.interchanges = (await prisma.interchange.deleteMany({ where: { tenantId: tenant.id } })).count;
      counts.rawFiles = (await prisma.rawFile.deleteMany({ where: { tenantId: tenant.id } })).count;
      counts.alerts = (await prisma.alert.deleteMany({ where: { tenantId: tenant.id } })).count;
      counts.tradingPartners = (await prisma.tradingPartner.deleteMany({ where: { tenantId: tenant.id } })).count;
      counts.users = (await prisma.user.deleteMany({ where: { tenantId: tenant.id } })).count;
      counts.auditEvents = (await prisma.auditEvent.deleteMany({ where: { tenantId: tenant.id } })).count;
      // Finally the tenant row itself. After this point the tenantId is
      // unreferenced; audit history is gone too (which is GDPR-correct
      // for a hard-delete request — the audit table is not the immune
      // exception people sometimes assume).
      await prisma.tenant.delete({ where: { id: tenant.id } });
    });

    results.set(tenant.id, counts);
  }

  return results;
}
