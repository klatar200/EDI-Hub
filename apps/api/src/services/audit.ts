/**
 * Phase 9 Sprint 4 — Audit emit service.
 *
 * Every route that mutates data wraps its write in `prisma.$transaction` and
 * calls `emitAudit(tx, ...)` inside the transaction. If the audit insert
 * fails (FK violation, JSON too large, anything), the data write rolls back
 * with it — audit coverage stays honest. Silent audit gaps are worse than a
 * user-facing error the operator can investigate.
 *
 * Why a separate helper rather than a Prisma middleware:
 *   - Middlewares fire per-query, but a single business action ("update
 *     partner") often spans several queries; we want one audit row per
 *     business action, not per query.
 *   - The actor identity comes from `request.auth`, which middlewares can't
 *     see. The route is the natural place to read it and pass it in.
 *
 * Actor identity:
 *   - Authenticated request → `request.auth.userId` (our User.id).
 *   - Dev-fallback (Clerk not configured) → null. The route should still
 *     audit, so we record the action even without a user reference.
 *   - Webhook / script writers — pass `actorId: null` explicitly.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { tenantContext } from '@edi/db';

export type AuditAction =
  | 'partner.create'
  | 'partner.update'
  | 'partner.delete'
  | 'alert.ack'
  | 'alert.snooze'
  | 'user.role-change'
  | 'user.profile-update'
  | 'user.delete'
  // Phase 10 Sprint 3 — retention worker + tenant lifecycle.
  | 'retention.run'
  | 'tenant.delete-requested'
  | 'tenant.hard-deleted'
  // Phase 10 Sprint 4 — rate-limit breach (best-effort audit so abuse
  // patterns show up in the audit log without blocking the 429 response).
  | 'rate.exceeded';

export type AuditTargetType = 'tradingPartner' | 'alert' | 'user' | 'tenant' | 'system';

export interface AuditDiff {
  before?: unknown;
  after?: unknown;
}

export interface EmitAuditInput {
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  /** User.id of the actor. Null for webhook / dev-fallback / scripted writes. */
  actorId: string | null;
  payloadDiff?: AuditDiff;
}

/**
 * Minimal transaction-client shape. The full `Prisma.TransactionClient` type
 * isn't always exported cleanly across Prisma 5/6 — this captures the only
 * call we make inside `emitAudit`. Both `PrismaClient` and the tx client
 * passed by `$transaction` satisfy it.
 */
export interface AuditCapableClient {
  auditEvent: {
    create: (args: { data: Prisma.AuditEventUncheckedCreateInput }) => Promise<unknown>;
  };
}

/**
 * Insert a single audit row. Must be called inside the same `$transaction`
 * as the data write — pass the tx client, not the top-level Prisma client.
 *
 * Tenant scope comes from the active `tenantContext` (set by the tenant
 * Fastify plugin). The Prisma extension would also auto-inject it, but we
 * pass it explicitly so the row is correctly attributed even when the
 * extension is bypassed (e.g. inside a webhook handler).
 */
export async function emitAudit(
  tx: AuditCapableClient,
  input: EmitAuditInput,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      tenantId: tenantContext.requireTenantId(),
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      payloadDiff: (input.payloadDiff ?? {}) as Prisma.InputJsonValue,
    },
  });
}

/**
 * Sugar for the common pattern of "do a write inside a transaction, then
 * record an audit row". Returns whatever the write returns.
 *
 * Usage:
 *   const updated = await withAudit(prisma, {
 *     action: 'partner.update',
 *     targetType: 'tradingPartner',
 *     actorId: request.auth?.userId ?? null,
 *   }, async (tx) => {
 *     return tx.tradingPartner.update({ where: { id }, data: { ... } });
 *   }, (row) => ({ targetId: row.id, after: row }));
 *
 * The third arg ("describe") receives the write's result and returns
 * `{ targetId, before?, after? }`. We delay the describe call until after
 * the write so callers can hand us the created/updated row directly.
 */
export async function withAudit<Result>(
  prisma: PrismaClient,
  meta: Omit<EmitAuditInput, 'targetId' | 'payloadDiff'>,
  write: (tx: Prisma.TransactionClient) => Promise<Result>,
  describe: (result: Result) => { targetId: string; before?: unknown; after?: unknown },
): Promise<Result> {
  return prisma.$transaction(async (tx) => {
    const result = await write(tx);
    const { targetId, before, after } = describe(result);
    await emitAudit(tx, {
      action: meta.action,
      targetType: meta.targetType,
      targetId,
      actorId: meta.actorId,
      payloadDiff: { before, after },
    });
    return result;
  });
}
