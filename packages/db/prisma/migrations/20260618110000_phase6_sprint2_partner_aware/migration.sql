-- Phase 6 Sprint 2 — partner-aware parser/lifecycle inputs + a per-txn
-- soft-config signal. Additive only; defaults preserve byte-for-byte
-- backward-compat (empty allow list = "accept anything").

ALTER TABLE "trading_partners"
  ADD COLUMN "supported_sets"     TEXT[]   NOT NULL DEFAULT '{}',
  ADD COLUMN "lifecycle_flows"    JSONB    NOT NULL DEFAULT '[]',
  ADD COLUMN "ack_code_overrides" JSONB    NOT NULL DEFAULT '{}';

ALTER TABLE "transactions"
  ADD COLUMN "config_flag" TEXT;

CREATE INDEX "transactions_config_flag_idx" ON "transactions"("config_flag");
