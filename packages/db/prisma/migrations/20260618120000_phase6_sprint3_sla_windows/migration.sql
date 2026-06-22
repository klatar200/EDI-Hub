-- Phase 6 Sprint 3 — per-partner SLA windows.
-- Empty array = no SLA configured; Phase 7's missing-ack detector treats that
-- as "no expectation" rather than "always violated" (Gate D-style accept-and-pass).

ALTER TABLE "trading_partners"
  ADD COLUMN "sla_windows" JSONB NOT NULL DEFAULT '[]';
