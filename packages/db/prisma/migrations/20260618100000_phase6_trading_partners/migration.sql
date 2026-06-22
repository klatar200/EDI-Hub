-- Phase 6 Sprint 1 — trading_partners table (identity + status + contacts).
-- Additive: existing transactions are NOT back-referenced. Per Gate C, the
-- partner is resolved on read from ISA IDs.

CREATE TYPE "PartnerStatus" AS ENUM ('active', 'disabled');

CREATE TABLE "trading_partners" (
  "id"               UUID NOT NULL,
  "tenant_id"        UUID,
  "display_name"     TEXT NOT NULL,
  "isa_sender_ids"   TEXT[] NOT NULL DEFAULT '{}',
  "isa_receiver_ids" TEXT[] NOT NULL DEFAULT '{}',
  "status"           "PartnerStatus" NOT NULL DEFAULT 'active',
  "notes"            TEXT,
  "contacts"         JSONB NOT NULL DEFAULT '[]',
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "trading_partners_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trading_partners_tenant_id_idx" ON "trading_partners"("tenant_id");
CREATE INDEX "trading_partners_status_idx"    ON "trading_partners"("status");

-- GIN indexes for fast ISA lookups (Gate A: arrays on the partner row).
CREATE INDEX "trading_partners_isa_sender_ids_gin"   ON "trading_partners" USING GIN ("isa_sender_ids");
CREATE INDEX "trading_partners_isa_receiver_ids_gin" ON "trading_partners" USING GIN ("isa_receiver_ids");

-- Gate E (ISA-ID overlap): Postgres can't easily enforce uniqueness across
-- elements of two array columns at the schema level without adding extension
-- support. The CRUD API layer is the strict guarantee — it scans for overlap
-- with the partner being upserted and returns 409 CONFLICT. Documented here
-- so future maintainers don't expect the DB to catch it on its own.
