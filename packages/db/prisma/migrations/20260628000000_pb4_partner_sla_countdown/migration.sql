-- PB-4 F33 — per-partner SLA countdown toggle
ALTER TABLE "trading_partners" ADD COLUMN "sla_countdown_enabled" BOOLEAN NOT NULL DEFAULT false;
