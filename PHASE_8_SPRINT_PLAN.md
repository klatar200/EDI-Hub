# Phase 8 — Outbound Visibility & Second Ingestion Channel: Sprint Plan

**Phase goal:** Close the inbound/outbound visibility gap and prove the
ingestion layer beyond one channel. Today the hub treats outbound and
inbound symmetrically — both arrive as files and we parse them. Phase 8
distinguishes the **lifecycle of an outbound transaction** (was it
*generated*, has it been *transmitted*, has the partner *confirmed receipt*?)
and surfaces the **silent-failure gap** between "we made it" and "they got
it." Then we cash in by adding a second connectivity channel beyond
HTTP upload + SFTP folder-watch.

**Exit criteria (= BUILD_PLAN Phase 8 exit):**
- Outbound lifecycle (generated / transmitted / confirmed) is visible per
  transaction in the hub.
- A second ingestion channel ingests reliably end-to-end.

**Estimated effort:** 2–4 weeks at 15–25 hrs/week. Mostly driven by Gate B
(which channel) — AS2 receive is heavier than a VAN-mailbox poll which is
heavier than an API webhook. We pick once the pilot answers.

**Builds on:** Phase 1 ingestion pipeline (HTTP + SFTP) — channels are
already pluggable so adding a third is structural, not a rewrite. Phase 4
lifecycle (we already track outbound direction). Phase 7 alerts (missing-ack
already covers "partner never confirmed"). Phase 6 partner config
(connectivity metadata was explicitly deferred from Phase 6 Q10 to here).

---

## What changes vs. Phase 7

| Layer | Today | Phase 8 adds |
|---|---|---|
| Outbound state | A `direction='outbound'` flag at ingestion | Three timestamp columns: `generatedAt`, `transmittedAt`, `confirmedAt` — derived state is the column populated furthest right |
| Lifecycle UI | Direction badge per row | Stage badge per outbound row (generated / transmitted / confirmed) + the "we lost it between generation and transmission" gap is visible |
| Partner config | Identity, sets, flows, SLAs, contacts | + `connectivity` JSONB (channel, endpoint, technical contact) |
| Ingestion channels | HTTP upload + SFTP folder-watch | + a third (per Gate B) — likely AS2 receive or VAN mailbox poll |
| Alerts | Missing 997 / rejection spike | Existing missing-ack covers "partner didn't confirm." New alert deferred unless Gate A unlocks "generated-but-not-transmitted" detection |

---

## Pre-Sprint: Decision Gates

| Gate | Question | Recommended default |
|---|---|---|
| **A — Outbound state acquisition** | How do we learn the *generated* state, before transmission? | **No ERP webhook in v1.** We can't honestly say "generated but not transmitted" without an upstream signal we don't have. So: `generatedAt = ingestedAt` (the moment we see the outbound copy), `transmittedAt` set on the same event when the source channel is the outbound transmission itself (vs. an internal ERP drop), `confirmedAt` set when the 997 ack arrives. Document the limitation honestly — full generated→transmitted gap detection is a Future Features item tied to ERP integration (Phase 11 or beyond). |
| **B — Second ingestion channel** | What's the second channel? | **Heavily pilot-dependent — open Q.** AS2 receive is the most common EDI transport beyond SFTP and the safest default. VAN mailbox poll is lighter but pilot-specific. API webhook is partner-specific. Lock to pilot answer. |
| **C — Connectivity metadata** | What goes on the partner record? | **Structural fields only.** `connectivity: { channel: 'AS2' \| 'SFTP' \| 'VAN' \| 'API' \| 'EMAIL', endpoint: string, technicalContact: string, notes?: string }`. Credentials stay in the env / secrets manager — referenced by name, never stored on the partner row. |
| **D — Outbound state representation** | Enum column, derived, or timestamps? | **Three nullable timestamps** (`generatedAt`, `transmittedAt`, `confirmedAt`) on `transactions`. State derived as "furthest-populated column." Easier than an enum because the timeline matters (you'd want to know *when* each transition happened anyway), and additive migrations stay cheap. |
| **E — Alerts for "not transmitted"** | New alert type, or rely on existing missing-ack? | **Rely on existing.** A real "generated but never transmitted" alert requires Gate A's ERP webhook. Until then, the missing-ack from Phase 7 covers the operationally-useful case ("partner didn't confirm receipt"). |
| **F — Outbound scope** | All four outbound sets (855/856/810/880), or a subset first? | **All four.** They're handled symmetrically; treating one as a special case adds complexity without saving work. |

---

## Sprint 1 — Outbound state model + UI surface (Week 1)

**Goal:** Every outbound transaction carries `generatedAt` / `transmittedAt`
/ `confirmedAt` timestamps; the lifecycle UI shows the derived stage; no
behavior change for inbound.

### Tasks
- **1.1 — Schema.** Add `generatedAt`, `transmittedAt`, `confirmedAt`
  (nullable timestamps) to `transactions`. Migration.
- **1.2 — Persistence.** `parsing.ts` sets `generatedAt` + `transmittedAt`
  = `ingestedAt` for outbound transactions (Gate A heuristic). Inbound
  transactions leave them null.
- **1.3 — Confirmed-state derivation.** When a 997 ack arrives that
  matches an outbound transaction (per Phase 4 stitching), set the
  original's `confirmedAt = ack.ingestedAt`. Backfill helper for already-
  stitched chains.
- **1.4 — Lifecycle event surface.** Extend `LifecycleEvent` in `@edi/shared`
  with `outboundStage: 'generated' | 'transmitted' | 'confirmed' | null`
  derived from the three columns. UI renders a small stage badge for
  outbound rows.
- **1.5 — Transaction detail surface.** Detail response includes the three
  timestamps; UI renders a tiny stage timeline (Generated → Transmitted →
  Confirmed) with checkmarks per stage.
- **1.6 — Tests.** Parser tests confirm the timestamps land; lifecycle
  tests confirm the stage derivation and ack-completion path; UI tests
  confirm the stage badge + timeline render.

**Acceptance:** An outbound 810 from a pilot partner shows "transmitted" on
ingest and flips to "confirmed" once the 997 lands.

---

## Sprint 2 — Second ingestion channel (Week 2-3)

**Goal:** A third connectivity channel feeds the hub end-to-end. The
pluggable shape from Phase 1 (HTTP + SFTP) gets a third sibling.

### Tasks (subject to Gate B answer)
- **2.1 — Connectivity adapter scaffold.** Refactor existing channels
  behind a tiny `IngestionChannel` interface so HTTP upload, SFTP, and the
  new channel share lifecycle hooks (start, stop, health).
- **2.2 — Implement the new channel.** Per Gate B answer:
  - **AS2:** integrate an existing OpenAS2 daemon as a separate process;
    hub watches the daemon's drop folder (essentially an SFTP variant
    with AS2-specific receipt + MDN handling on the daemon side).
  - **VAN mailbox poll:** scheduled FTPS/SFTP pull from the VAN's mailbox.
  - **API webhook:** new `/ingest/webhook/:partnerId` endpoint with
    signature verification per partner.
- **2.3 — Config + env.** New env vars for the channel; documented in
  `.env.example`.
- **2.4 — Health check.** Channel exposes a status pingable from `/health`.
- **2.5 — Tests.** Integration tests for the new channel against a fake
  endpoint; smoke test against a real one.

**Acceptance:** A test file delivered via the new channel lands in S3,
parses, and shows on the transactions list with the right `direction`.

---

## Sprint 3 — Connectivity metadata + Phase exit (Week 3-4)

**Goal:** Partner records carry connectivity metadata; the editor surfaces
it; demo the full inbound + outbound + dual-channel picture against pilot
data.

### Tasks
- **3.1 — Schema.** `connectivity` JSONB on `trading_partners` per Gate C:
  `{ channel, endpoint, technicalContact, notes? }`. The column was
  already in the Phase 6 Sprint 1 migration as `connectivity` but unused —
  Sprint 3 starts reading and writing.
- **3.2 — Shared types + CRUD.** Extend `TradingPartnerRecord` +
  `PartnerConfigInput`. Validation in `partners.ts`. Route accepts +
  returns it.
- **3.3 — Editor section.** New "Connectivity" section in
  `PartnersConfigPage`'s editor with channel dropdown, endpoint, technical
  contact email, and notes.
- **3.4 — Lifecycle UI polish.** Outbound rows show the partner's channel
  next to the stage badge so ops can see at a glance how a particular
  transaction was transmitted.
- **3.5 — Pilot review + Phase exit.** End-to-end test: configure a pilot
  partner's connectivity, ingest from both channels, verify outbound
  lifecycle stages flip correctly. Capture stakeholder feedback.

**Acceptance (= Phase 8 exit):** Outbound transactions show full
generated → transmitted → confirmed stages; the second ingestion channel
is ingesting reliably; partner connectivity metadata is captured.

---

## Testing approach

- **Parser/persistence:** outbound vs inbound timestamp behavior; ack-arrival
  flipping `confirmedAt`.
- **Lifecycle service:** stage derivation; backfill for pre-Phase-8 rows.
- **New channel:** mocked end-to-end ingestion; partner-routed receipt
  where applicable.
- **Web:** stage badge + timeline rendering; connectivity editor.
- **Manual:** Sprint 3 demo against pilot data with both channels live.

---

## Explicitly out of scope

- **ERP webhook for true "generated" state** — Future Features (tied to
  Phase 11 self-serve onboarding when partners can configure their own
  webhook secrets).
- **Active retransmission / "fix and resend"** — passive observability
  stays the rule (BUILD_PLAN principle #5).
- **Building an AS2 daemon from scratch** — integrate an existing one
  (OpenAS2 or similar) if Gate B picks AS2.
- **Multi-protocol fan-out for outbound** — we observe, we don't
  transmit.

---

## Open Questions

1. **(Gate A)** Does the pilot have ERP-integration ability to webhook us
   when an outbound transaction is *generated* (before transmission)? If
   not, we accept the Gate A default — `generatedAt = transmittedAt =
   ingestedAt` — and add the true generation hook to Future Features.
2. **(Gate B)** What's the second ingestion channel the pilot needs?
   AS2 receive, VAN mailbox poll, API webhook, IMAP, or something else?
   This drives Sprint 2's scope significantly.
3. **(Gate C)** Connectivity metadata fields — channel + endpoint +
   technical contact + notes enough, or do we need to surface credential
   references too?
4. **(Gate D)** Confirm: store three nullable timestamps
   (`generatedAt`/`transmittedAt`/`confirmedAt`) and derive the stage,
   rather than a state enum.
5. **(Gate E)** OK to defer a dedicated "generated but not transmitted"
   alert (relying on existing missing-ack as proxy)?
6. **(Gate F)** Outbound visibility for all four pilot outbound sets
   (855/856/810/880) at once, or one-at-a-time?
7. What's the typical lag the pilot expects between generation and
   transmission? Influences alert thresholds if/when Gate A unlocks the
   generation signal.
8. Is there a test environment for the second channel (AS2 sandbox, VAN
   test mailbox, etc.), or do we mock for now and validate against
   production-ish on demo day?
