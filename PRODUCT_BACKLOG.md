# EDI Data Hub — Product Backlog (historical)

**Status:** All approved features **shipped** as of **PB-8** (2026-06-25).  
**Live matrix:** [`docs/FEATURE_STATUS.md`](docs/FEATURE_STATUS.md) · **Active roadmap:** [`BUILD_PLAN.md`](BUILD_PLAN.md) §3

**North Star:** Lifecycle-centric monitoring — PO/conversation as the primary unit.

This file is the historical record of product decisions (Rounds 1–3). Do not add new features here — use [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md) for optional/deferred ideas.

---

## Round 1 — Approved (all shipped)

| ID | Feature | Status |
|---|---|---|
| F1 | Ops home dashboard | ✅ |
| F2 | Stale-traffic alerts | ✅ |
| F3 | Partner health summary | ✅ |
| F4′ | Lifecycle-first homepage | ✅ |
| F5 | Ingestion failure triage | ✅ |
| F6 | Startup reconcile (W3.1 Option B) | ✅ |
| F7 | Typed 855 / 856 headers | ✅ |
| F8 | Alert partner filter + bulk ack | ✅ |
| F9 | Expected-document warnings | ✅ |
| F10 | Channel health page | ✅ |
| F11 | Outbound delivery timeline | ✅ |
| F13 | Notification quiet hours | ✅ |
| F14 | Desktop Clerk in releases | ✅ |
| F15 | Duplicate document compare | ✅ |
| F16 | Saved views / shared filters | ✅ |
| F19 | Per-partner dictionary override UI | ✅ |
| F20 | Theme toggle in settings | ✅ |
| F21 | Extended transaction-set support | ✅ (Tier B: 860/875/880) |
| F22 | Audit log viewer (admin) | ✅ |

**Declined:** F12, F17, F18

---

## Round 2 — Decisions (all resolved)

| ID | Feature | Decision | Shipped |
|---|---|---|---|
| F23 | Document flow strip (MXC-style) | ⛔ Declined | — |
| F24 | Next activity column | ⛔ Declined | — |
| F25 | Expand-in-place lifecycle detail | ✅ Approved | ✅ |
| F26 | Lifecycle list filters | ✅ Approved | ✅ |
| F27 | Conversation due dates | ✅ Approved (PB-8) | ✅ |
| F28 | Additional documents indicator | ✅ Approved | ✅ |
| F29 | Global traffic silence widget | ✅ → F45 on dashboard | ✅ |
| F30 | Worst-first default sort | ⛔ Declined | — |
| F31 | Phased transaction-set roadmap | ✅ Approved | ✅ |
| F32 | Parse-error rollup on lifecycle row | ✅ Approved | ✅ |
| F33 | SLA countdown on row | ✅ Approved | ✅ |
| F34 | Export lifecycle | ✅ Approved | ✅ |
| F35 | Re-parse from triage | ✅ → F54 | ✅ |
| F36 | Control numbers on expand | ⛔ Declined | — |
| F37 | Multi-PO invoice linking | ✅ Scoped (PB-8) | ✅ |
| F38 | Shipment ID entry point | ✅ Search + lifecycle (PB-8) | ✅ |
| F39 | First-run LAN URL helper | ✅ Approved | ✅ |
| F40 | What's new after update | ✅ Approved | ✅ |

---

## Round 3 — Approved (all shipped, 2026-06-25)

| ID | Feature | Status |
|---|---|---|
| F41 | Lifecycle row status summary | ✅ |
| F42 | Search → lifecycle first | ✅ |
| F43 | Pinned / watchlist POs | ✅ |
| F44 | Lifecycle list default sort | ✅ |
| F45 | Traffic silence card | ✅ |
| F46 | Open alerts summary card | ✅ |
| F47 | Ingest health card | ✅ |
| F48 | Rejection sparkline | ✅ |
| F49 | Unknown ISA sender alert | ✅ |
| F50 | Run detection from UI | ✅ |
| F51 | Email digest | ✅ |
| F52 | Settings hub | ✅ |
| F53 | Duplicate file explanation | ✅ |
| F54 | Retry parse | ✅ |
| F55 | Raw download from lifecycle expand | ✅ |
| F56 | Ops notes on lifecycle | ✅ |
| F57 | Bulk export | ✅ |
| F58 | Export includes raw EDI | ✅ |
| F59 | Transaction set glossary | ✅ |
| F60 | Parser improvement feedback | ✅ |
| F61 | Help menu docs | ✅ |
| F62 | Copy LAN URL anytime | ✅ |

---

## Sprint mapping (complete)

Execution was grouped into **PS-0–PS-12** and **PB-1–PB-8** in [`BUILD_PLAN.md`](BUILD_PLAN.md) §6.

---

## Original clarifications (for context)

<details>
<summary>F27, F29, F35, F38 — what these meant</summary>

**F27 — Due dates:** Requested delivery date from 850 DTM on lifecycle list rows. Shipped PB-8.

**F29 — Traffic silence:** Dashboard card for global/partner last-seen ingest times. Shipped as F45 on ops dashboard.

**F35 / F54 — Retry parse:** Re-run parser on stored raw file from triage or expanded lifecycle. Shipped PS-5 / PB-2.

**F38 — Shipment entry:** `GET /lifecycle?shipment=` plus search deep links. Shipped PB-8 (search-first; no homepage ASN filter by design).

</details>
