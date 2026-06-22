-- Phase 8 Sprint 3 — connectivity metadata on trading_partners.
--
-- Gate C shape:
--   { channel: 'AS2' | 'SFTP' | 'VAN' | 'API' | 'EMAIL',
--     endpoint: string,
--     technicalContact: string,    -- email address
--     notes?: string }
--
-- Credentials stay out of the database — they live in env / secrets manager
-- and are referenced by name in `endpoint` (e.g. "sftp://partner.example.com/in,
-- creds=SECRET:partner-sftp"). The DB never stores secret values.
--
-- Default '{}' so existing partner rows remain valid (the channel block is
-- optional for partners we haven't yet configured connectivity for).
--
-- Additive only — no backfill needed.

ALTER TABLE "trading_partners"
  ADD COLUMN "connectivity" JSONB NOT NULL DEFAULT '{}';
