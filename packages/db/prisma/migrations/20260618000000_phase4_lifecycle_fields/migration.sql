-- Phase 4 Sprint 1 — Lifecycle linkage fields on `transactions`.
--
-- Additive, nullable migration. Existing rows get `direction = 'unknown'`
-- (the enum default); other new columns stay NULL until the backfill script
-- re-parses them.

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('inbound', 'outbound', 'unknown');

-- AlterTable: lifecycle linkage columns.
ALTER TABLE "transactions"
  ADD COLUMN "shipment_id"           TEXT,
  ADD COLUMN "acked_group_control"   TEXT,
  ADD COLUMN "acked_txn_controls"    JSONB,
  ADD COLUMN "ack_status"            TEXT,
  ADD COLUMN "direction"             "Direction" NOT NULL DEFAULT 'unknown';

-- CreateIndex
CREATE INDEX "transactions_shipment_id_idx"         ON "transactions"("shipment_id");
CREATE INDEX "transactions_acked_group_control_idx" ON "transactions"("acked_group_control");
CREATE INDEX "transactions_direction_idx"           ON "transactions"("direction");
