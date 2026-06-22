-- Phase 8 Sprint 2 — add 'as2' to SourceChannel.
--
-- The OpenAS2 daemon handles the AS2 handshake (signature, encryption, MDN)
-- server-side and drops the plaintext EDI into a watched folder. The hub
-- ingests those bytes and tags the raw_files row with source='as2'.
--
-- ALTER TYPE ... ADD VALUE is non-transactional in older Postgres versions —
-- safe and supported in 12+. Additive only; no data backfill needed.

ALTER TYPE "SourceChannel" ADD VALUE IF NOT EXISTS 'as2';
