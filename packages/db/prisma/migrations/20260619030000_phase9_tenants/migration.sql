-- Phase 9 Sprint 1 — Multi-tenancy foundation.
--
-- Adds the `tenants` table and a NOT NULL `tenant_id` column on every
-- multi-tenant table. All existing data belongs to a single pilot tenant
-- which is created here and backfilled across every row in one transaction.
--
-- Order matters because of the NOT NULL constraint:
--   1. Create the `tenants` table.
--   2. Seed the pilot tenant.
--   3. Add `tenant_id` as nullable on each table, backfill, then ALTER NOT NULL.
-- Doing it as a single migration keeps Sprint 2 simpler — Prisma sees a
-- consistent schema before the extension turns on.
--
-- Sprint 1.4 also moves OUR_ISA_IDS from the env var to a column on
-- `tenants`. We default it to '{}' here and let the Sprint 1 seed write the
-- pilot's actual list via a small one-shot script (see apps/api/src/scripts/
-- seed-pilot-tenant.ts), so the migration stays infra-only.

-- ─────────────────────────────────────────────────────────────
-- 1. tenants table
-- ─────────────────────────────────────────────────────────────

CREATE TABLE "tenants" (
  "id"              UUID         NOT NULL,
  "display_name"    TEXT         NOT NULL,
  -- Clerk Organization id (`org_*`). Populated by the Clerk webhook in
  -- Sprint 2; nullable until then so the pilot tenant can be seeded today.
  "clerk_org_id"    TEXT,
  "our_isa_ids"     TEXT[]       NOT NULL DEFAULT '{}',
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_clerk_org_id_key" ON "tenants"("clerk_org_id");

-- ─────────────────────────────────────────────────────────────
-- 2. Seed the pilot tenant (every existing row will be assigned to it).
-- ─────────────────────────────────────────────────────────────

INSERT INTO "tenants" ("id", "display_name", "clerk_org_id", "our_isa_ids")
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Pilot',
  NULL,
  '{}'::TEXT[]
);

-- ─────────────────────────────────────────────────────────────
-- 3. tenant_id columns + backfill + NOT NULL
--
-- trading_partners already has a nullable tenant_id from Phase 6. Backfill
-- and tighten the constraint. Every other table gets the column fresh.
-- ─────────────────────────────────────────────────────────────

-- trading_partners: backfill the existing nullable column, then NOT NULL.
UPDATE "trading_partners" SET "tenant_id" = '00000000-0000-0000-0000-000000000001'
  WHERE "tenant_id" IS NULL;
ALTER TABLE "trading_partners" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "trading_partners"
  ADD CONSTRAINT "trading_partners_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;

-- raw_files
ALTER TABLE "raw_files" ADD COLUMN "tenant_id" UUID;
UPDATE "raw_files" SET "tenant_id" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "raw_files" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "raw_files"
  ADD CONSTRAINT "raw_files_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "raw_files_tenant_id_ingested_at_idx" ON "raw_files"("tenant_id", "ingested_at");

-- interchanges
ALTER TABLE "interchanges" ADD COLUMN "tenant_id" UUID;
UPDATE "interchanges" SET "tenant_id" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "interchanges" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "interchanges"
  ADD CONSTRAINT "interchanges_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "interchanges_tenant_id_idx" ON "interchanges"("tenant_id");

-- functional_groups
ALTER TABLE "functional_groups" ADD COLUMN "tenant_id" UUID;
UPDATE "functional_groups" SET "tenant_id" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "functional_groups" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "functional_groups"
  ADD CONSTRAINT "functional_groups_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "functional_groups_tenant_id_idx" ON "functional_groups"("tenant_id");

-- transactions
ALTER TABLE "transactions" ADD COLUMN "tenant_id" UUID;
UPDATE "transactions" SET "tenant_id" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "transactions" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "transactions_tenant_id_idx" ON "transactions"("tenant_id");

-- segments
ALTER TABLE "segments" ADD COLUMN "tenant_id" UUID;
UPDATE "segments" SET "tenant_id" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "segments" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "segments"
  ADD CONSTRAINT "segments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "segments_tenant_id_idx" ON "segments"("tenant_id");

-- elements
ALTER TABLE "elements" ADD COLUMN "tenant_id" UUID;
UPDATE "elements" SET "tenant_id" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "elements" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "elements"
  ADD CONSTRAINT "elements_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "elements_tenant_id_idx" ON "elements"("tenant_id");

-- alerts
ALTER TABLE "alerts" ADD COLUMN "tenant_id" UUID;
UPDATE "alerts" SET "tenant_id" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "alerts" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "alerts"
  ADD CONSTRAINT "alerts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "alerts_tenant_id_created_at_idx" ON "alerts"("tenant_id", "created_at");
