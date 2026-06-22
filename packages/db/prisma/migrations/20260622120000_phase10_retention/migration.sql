-- Phase 10 Sprint 3 — Retention policy + tenant soft-delete + RawFile ARCHIVED status.
--
-- The retention worker (apps/api/src/services/retention.ts) reads
-- `tenants.retention` on every sweep and deletes rows past their per-
-- category TTL. RawFile rows flip to ARCHIVED rather than being deleted
-- so the lineage from a parsed transaction back to its source file
-- survives. Tenant soft-delete lets an admin request removal; the
-- retention worker hard-deletes 30 days later (BUILD_PLAN open question
-- #6 — GDPR-friendly grace window).

-- ARCHIVED enum value — must be added before any code references it.
ALTER TYPE "RawFileStatus" ADD VALUE 'ARCHIVED';

-- Retention policy on every tenant. Default applies to the pilot row
-- (and any future rows) without needing a separate backfill UPDATE.
ALTER TABLE "tenants"
  ADD COLUMN "retention" JSONB NOT NULL
    DEFAULT '{"rawFiles":540,"parsedTree":540,"auditEvents":365,"alerts":365}'::jsonb;

-- Tenant soft-delete marker. NULL = active; non-null = pending hard-delete.
ALTER TABLE "tenants" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Index helps the sweeper find "tenants past the 30-day grace" quickly.
CREATE INDEX "tenants_deleted_at_idx" ON "tenants"("deleted_at");
