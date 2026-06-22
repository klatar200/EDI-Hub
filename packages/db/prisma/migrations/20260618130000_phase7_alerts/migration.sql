-- Phase 7 Sprint 1 — alerts table + enums.
-- Additive. Detection writes here idempotently via dedupe_key.

CREATE TYPE "AlertType"     AS ENUM ('MISSING_ACK', 'REJECTION_RATE_SPIKE', 'STALE_TRAFFIC');
CREATE TYPE "AlertStatus"   AS ENUM ('active', 'acknowledged', 'resolved');
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

CREATE TABLE "alerts" (
  "id"              UUID         NOT NULL,
  "partner_id"      UUID,
  "type"            "AlertType"  NOT NULL,
  "severity"        "AlertSeverity" NOT NULL DEFAULT 'warning',
  "title"           TEXT         NOT NULL,
  "body"            TEXT         NOT NULL,
  "dedupe_key"      TEXT         NOT NULL,
  "source_ref"      JSONB        NOT NULL DEFAULT '{}',
  "status"          "AlertStatus" NOT NULL DEFAULT 'active',
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledged_at" TIMESTAMP(3),
  "acknowledged_by" TEXT,
  "suppress_until"  TIMESTAMP(3),

  CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "alerts_dedupe_key_key" ON "alerts"("dedupe_key");
CREATE INDEX "alerts_partner_id_idx"  ON "alerts"("partner_id");
CREATE INDEX "alerts_type_idx"        ON "alerts"("type");
CREATE INDEX "alerts_status_idx"      ON "alerts"("status");
CREATE INDEX "alerts_created_at_idx"  ON "alerts"("created_at");
