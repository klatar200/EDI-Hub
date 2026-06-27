# EDI Data Hub — Product Backlog (approved)

**Purpose:** Features reviewed and approved (with notes). Sprint grouping comes after recommendation rounds are complete.

**North Star:** Lifecycle-centric monitoring — PO/conversation as the primary unit, not individual ST rows.

**Design reference:** Epicor MXC informed *what information is valuable* (conversation overview, alerts, document status at a glance). We are **not** copying MXC layout literally — we build a cleaner, modern EDI Hub experience on our own components.

---

## Approved — Round 1

| ID | Feature | Notes |
|---|---|---|
| **F1** | Ops home dashboard | Open alerts, partner issues, rejection highlights, recent ingest failures, quick links. |
| **F2** | Stale-traffic alerts | **(1)** Global default when *no* traffic from *any* partner in X time. **(2)** Per-partner opt-in at **2× longest SLA**. Broad first, then specific. |
| **F3** | Partner health summary | Last ingestion, last ack, rejection %, open alerts, missing-ack count. |
| **F4′** | **Lifecycle-first homepage** | Home = PO/conversation list. Row: PO + overview of sent/received + alerts. Expand → transactions + detail. Transaction list demoted to drill-down. |
| **F5** | Ingestion failure triage | Filter PARSE_ERROR / FAILED / DUPLICATE; error summary; re-upload or raw link. |
| **F6** | Startup reconcile (W3.1 Option B) | Re-parse `RECEIVED` rows never parsed on API boot. |
| **F7** | Typed 855 / 856 headers | Ship dates, quantities, carrier refs on detail + lifecycle. |
| **F8** | Alert partner filter + bulk ack | Filter by partner name; ack-all; sort by age vs SLA. |
| **F9** | Expected-document warnings | Proactive missing-doc warnings before SLA breach. |
| **F10** | Channel health page | SFTP / AS2 / upload status + links to ingestions. |
| **F11** | Outbound delivery timeline | generated → transmitted → 997 confirmed. |
| **F13** | Notification quiet hours | ⏳ Nice-to-have, not priority. |
| **F14** | Desktop Clerk in releases | **ASAP** — secrets in GitHub release pipeline. |
| **F15** | Duplicate document compare | Side-by-side duplicates on same PO. |
| **F16** | Saved views / shared filters | Named filter presets. |
| **F19** | Per-partner dictionary override UI | Form editor for Z-segment / custom labels. |
| **F20** | Theme toggle in settings | Move out of header. |
| **F21** | Extended transaction-set support | Phased via **F31** — extend without dev hell. |
| **F22** | Audit log viewer (admin) | Searchable mutation history. |

### Declined — Round 1

F12 calendar SLAs · F17 escalation chains · F18 PagerDuty/Opsgenie

---

## Round 2 — Decisions

| ID | Feature | Decision | Notes |
|---|---|---|---|
| **F23** | Document flow strip (MXC-style) | ❌ Declined | Don’t mirror Epicor literally; design our own meaningful row overview (see F4′). |
| **F24** | Next activity column | ❌ Declined | Too niche; don’t force on every customer. |
| **F25** | Expand-in-place lifecycle detail | ✅ Approved | Nested detail on same page — modern, no extra navigation/load. |
| **F26** | Lifecycle list filters | ✅ Approved | Date range, doc type, partner, alert status, etc. |
| **F27** | Conversation due dates | ❓ Clarified → **Later** | See [F27 explained](#f27--conversation-due-dates) below. Revisit if customers ask for PO deadline sorting. |
| **F28** | Additional documents indicator | ✅ Approved | “N additional document(s) in this conversation” when duplicates/extras exist. |
| **F29** | Global traffic silence widget | ❓ Clarified → **Optional** | See [F29 explained](#f29--global-traffic-silence-widget). Fold into F1 ops dashboard if approved in R3. |
| **F30** | Worst-first default sort | ❌ Declined | **Default sort:** lifecycle start date (first document sent/received), newest or oldest TBD at build time. |
| **F31** | Phased transaction-set roadmap | ✅ Approved | Tier A/B/C scope gates per sprint. |
| **F32** | Parse-error rollup on lifecycle row | ✅ Approved | Warning on conversation row → triage. |
| **F33** | SLA countdown on row | ✅ Approved (optional) | **Toggle:** global setting and/or per-partner; off by default. |
| **F34** | Export lifecycle | ✅ Approved | **TXT, PDF, CSV.** *(You wrote “Also, should be able to export” — confirm in R3 what else: bulk selected rows? raw EDI bundle?)* |
| **F35** | Re-parse from triage | ❓ Clarified → **Pending** | See [F35 explained](#f35--re-parse-from-triage). |
| **F36** | Control numbers on expand | ❌ Declined | Not necessary. |
| **F37** | Multi-PO invoice linking | ✅ Later / scoped | Optional view when opening **810** or searching **invoice number** — not primary lifecycle entry. |
| **F38** | Shipment ID entry point | ❓ See below | Already in API; stability varies by partner. **Recommend: keep search support, don’t prioritize in homepage filters.** |
| **F39** | First-run LAN URL helper | ✅ Approved | See [F39 explained](#f39--first-run-lan-url-helper). |
| **F40** | What’s new after update | ✅ Approved (modified) | Link in **desktop Help dropdown**, not a mandatory popup. |

---

## Clarifications (items you asked about)

### F27 — Conversation due dates

**What it meant:** Show a **requested delivery / PO due date** on each lifecycle row — usually from the **850** (e.g. BEG date fields or DTM segments) or a date you configure on the partner.

**Example:** “PO 15683980 · **Due 4/8/2026**” so ops sorts/filters by urgency.

**Recommendation:** Defer until lifecycle homepage ships; add only if your workflows need deadline-based sorting (you didn’t ask for this yet).

### F29 — Global traffic silence widget

**What it meant:** On the **ops dashboard (F1)**, a card like: *“No EDI received from any partner in the last 6 hours”* with a per-partner breakdown of last-seen times.

This is the **UI counterpart** to F2 tier-1 (global stale-traffic alert) — visible before you open Alerts.

**Recommendation:** Include as one F1 widget, not a separate product surface.

### F35 — Re-parse from triage

**What it meant:** For a file stuck in **PARSE_ERROR** or **RECEIVED** (never parsed): a button **“Retry parse”** that re-runs the parser on the **existing raw file** in storage — no re-upload.

Useful when you fixed parser code, partner dictionary (F19), or a transient failure.

### F38 — Shipment ID as lifecycle entry

**Already built:** `GET /lifecycle?shipment=…` resolves to a PO via **856 BSN02** (`shipmentId` on transactions).

**Stability:**

| Reliable when… | Unreliable when… |
|---|---|
| Partner sends 856 with consistent BSN shipment ID + PRF PO reference | Partner omits BSN, uses proprietary refs, or one shipment spans multiple POs |
| Single PO per ASN (common in retail) | Cross-dock / consolidated ASNs |

**Recommendation:** Keep **search** by shipment ID; don’t build homepage/filter UX around ASN until a customer needs it. Your day-to-day PO-centric workflow is the right default.

### F39 — First-run LAN URL helper

**What it meant:** Desktop first-run wizard shows:

- This machine’s LAN URL: `http://192.168.1.50:3000`
- Copy button for users on other PCs
- Pre-fill **Clerk authorized parties** with that URL (plus localhost)

Today LAN installs require manual `CLERK_AUTHORIZED_PARTIES` editing (`LAN_INSTALL.md`).

---

## Round 3 — Approved (2026-06-25)

Focused on monitoring, troubleshooting, and lifecycle-first UX — no MXC clones, no niche forced workflows. Execution grouped into PB-1–PB-8 in `BUILD_PLAN.md` §6.

### Lifecycle homepage & search

| ID | Feature | What you'd get |
|---|---|---|
| **F41** | **Lifecycle row status summary (our design)** | Compact custom overview per row: partner, flow type, received/missing/rejected counts, open alert badge — **not** a literal ORDER→ACK strip. Delivers F4′ value without F23. |
| **F42** | **Search → lifecycle first** | Global search returns **conversations (POs)** as primary results; invoice/shipment/ISA as secondary entry points. |
| **F43** | **Pinned / watchlist POs** | Pin critical POs to top of list (user-scoped); optional filter “Pinned only”. |
| **F44** | **Lifecycle list default sort** | First document timestamp in conversation (you chose this over worst-first); configurable asc/desc in saved views (F16). |

### Ops dashboard (F1 building blocks)

| ID | Feature | What you'd get |
|---|---|---|
| **F45** | **Traffic silence card** | F29 as part of F1: last ingest per partner + global “all quiet since …” |
| **F46** | **Open alerts summary card** | Count by severity/partner with one-click filter on lifecycle list |
| **F47** | **Ingest health card** | Last 24h: parsed / failed / duplicate counts + link to F5 triage |
| **F48** | **Rejection sparkline** | 7-day rejection rate mini-chart per top partners (extends Metrics page) |

### Monitoring & detection

| ID | Feature | What you'd get |
|---|---|---|
| **F49** | **Unknown ISA sender alert** | Alert when interchange sender/receiver IDs don’t match any configured partner |
| **F50** | **Run detection from UI** | Ops button to trigger missing-ack / spike / stale-traffic pass (today: `npm run detect`) |
| **F51** | **Email digest (optional)** | Scheduled summary to partner contact email list — daily open alerts + stale partners (no escalation chains) |
| **F52** | **Settings hub** | One place for global toggles: F33 SLA countdown, F13 quiet hours, F2 global silence window, theme (F20) |

### Troubleshooting

| ID | Feature | What you'd get |
|---|---|---|
| **F53** | **Duplicate file explanation** | On DUPLICATE ingestions: “Same ISA control number as file X ingested at …” |
| **F54** | **Retry parse** (F35) | One-click re-parse from triage / expanded lifecycle — pending your OK |
| **F55** | **Raw download from lifecycle expand** | Download original EDI for any transaction in expanded row |
| **F56** | **Ops notes on lifecycle** | Free-text note on a PO conversation (tenant-scoped, audited) — “called Sysco 6/27” |

### Export & reporting (extends F34)

| ID | Feature | What you'd get |
|---|---|---|
| **F57** | **Bulk export** | Select multiple lifecycle rows → ZIP of TXT/PDF/CSV summaries |
| **F58** | **Export includes raw EDI** | Optional checkbox to attach raw file(s) in export bundle |

### Parser & data (extends F31)

| ID | Feature | What you'd get |
|---|---|---|
| **F59** | **Transaction set glossary** | In-app help: what 850/855/856/810/997 mean + link to detail |
| **F60** | **Parser improvement feedback loop** | From PARSE_ERROR row: “report segment/element” copies context for dev/partner ticket |

### Desktop

| ID | Feature | What you'd get |
|---|---|---|
| **F61** | **Help menu: What’s new + docs** | F40 link + link to release notes URL / changelog in GitHub Releases |
| **F62** | **Copy LAN URL anytime** | Help menu item (not only first-run F39) for desktop admins |

---

## How to respond

**Round 3:** Agree / Disagree / Later per **F41–F62**, plus:

1. **F34 follow-up:** What did you mean after “should be able to export …”?
2. **F35 / F54:** OK to merge as “Retry parse” from triage?
3. **F27 / F38:** OK to leave as Later / search-only?

When rounds feel complete, we’ll group approved items into sprints in `BUILD_PLAN.md`.
