-- Phase 8 Sprint 1 — outbound transaction lifecycle timestamps.
--
-- Three nullable timestamps on `transactions` whose furthest-populated column
-- derives the outbound stage (generated → transmitted → confirmed). Inbound
-- transactions leave them null; the lifecycle service ignores them for inbound.
--
-- Why three columns instead of an enum: the timeline matters — operators want
-- to know *when* each transition happened, not just that it did. Additive
-- migrations stay cheap, and the derivation is one column-coalesce away.
--
-- Gate A note: until ERP integration lands, generatedAt and transmittedAt are
-- both set to the moment we observe the outbound copy (i.e. ingestedAt). The
-- column shape is the right one for the future signal; the semantics will
-- sharpen when Future Features wires the upstream webhook in.

ALTER TABLE "transactions"
  ADD COLUMN "generated_at"   TIMESTAMP(3),
  ADD COLUMN "transmitted_at" TIMESTAMP(3),
  ADD COLUMN "confirmed_at"   TIMESTAMP(3);

-- Indexed because Phase 7's missing-ack detector (and Sprint 1.3's confirmedAt
-- backfill) scan outbound transactions by (direction, confirmedAt IS NULL).
CREATE INDEX "transactions_confirmed_at_idx" ON "transactions"("confirmed_at");
