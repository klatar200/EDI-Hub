-- Phase 9 Sprint 4 — Audit events table.
--
-- Every state-changing route writes a row inside the same Prisma $transaction
-- as the data mutation, so a failed audit insert rolls back the data write.
-- Coverage stays honest: a silently missing audit row would be far worse than
-- a user-facing 500 the operator can investigate.
--
-- actor_id is nullable so webhook / dev-fallback / scripted actions can still
-- emit audit rows when no User row is in scope.

CREATE TABLE "audit_events" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"    UUID         NOT NULL,
    "actor_id"     UUID,
    "action"       TEXT         NOT NULL,
    "target_type"  TEXT         NOT NULL,
    "target_id"    TEXT         NOT NULL,
    "payload_diff" JSONB        NOT NULL DEFAULT '{}'::jsonb,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- Foreign key to tenants. Restrict so a tenant with audit history can't be
-- accidentally deleted (audit data is intentionally retained).
ALTER TABLE "audit_events"
    ADD CONSTRAINT "audit_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The hot read paths from /audit:
--   1. Filter by tenant (always — done by the Prisma extension) and sort by
--      createdAt DESC — composite index for that.
CREATE INDEX "audit_events_tenant_id_created_at_idx"
    ON "audit_events"("tenant_id", "created_at");

--   2. Filter by actor in the admin audit UI.
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events"("actor_id");

--   3. Filter by action name (e.g. only `alert.ack` events).
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action");
