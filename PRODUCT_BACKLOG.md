# EDI Data Hub — Product Backlog (approved)

**Purpose:** Features Keagan has reviewed and approved (with notes). Not yet scheduled — grouping and sprint plan comes after Round 2 recommendations are reviewed.

**North Star:** Lifecycle-centric monitoring — PO/conversation as the primary unit, not individual ST rows.

**Reference UI:** Epicor Managed X Change list (lifecycle rows with document flow strip, alert summary, next activity). We aim for similar information density with a cleaner, modern UX.

---

## Approved — Round 1

| ID | Feature | Status | Notes |
|---|---|---|---|
| **F1** | Ops home dashboard | ✅ Approved | “What’s on fire?” landing: open alerts, partner issues, rejection highlights, recent ingest failures, quick links. |
| **F2** | Stale-traffic alerts | ✅ Approved (modified) | **Two tiers:** (1) **Global default** — alert when *no* transactions have arrived from *any* trading partner within a configurable window. (2) **Per-partner optional** — alert when a specific partner exceeds **2× their longest SLA** without traffic. Implement broad default first, then partner-specific opt-in. |
| **F3** | Partner health summary | ✅ Approved | Per-partner status: last ingestion, last ack, rejection %, open alerts, missing-ack count. |
| **F4** | Lifecycle shortcuts everywhere | ❌ Replaced | See **F4′** below — lifecycle-first homepage, not shortcuts from transaction list. |
| **F4′** | **Lifecycle-first homepage** | ✅ Approved (replaces F4) | **Home = conversation list** (PO-centric), not individual transactions. Each row: PO identity, document flow overview (sent/received), alert summary. **Expand row** → underlying transactions + detail. Individual transaction drill-down lives *inside* lifecycle, not as the default list. Inspired by Epicor MXC; target better UX. |
| **F5** | Ingestion failure triage | ✅ Approved | Filter PARSE_ERROR / FAILED / DUPLICATE; error summary; re-upload or link to raw. |
| **F6** | Startup reconcile (W3.1 Option B) | ✅ Approved | On API boot: re-parse `RECEIVED` rows never parsed. |
| **F7** | Typed 855 / 856 headers | ✅ Approved | Ship dates, quantities, carrier refs on detail + lifecycle chips. |
| **F8** | Alert partner filter + bulk ack | ✅ Approved | Filter by partner name; ack-all for partner; sort by age vs SLA. |
| **F9** | Expected-document warnings on lifecycle | ✅ Approved | Proactive warnings before SLA breach (“856 typically within 24h of 855 — still missing”). |
| **F10** | Channel health page | ✅ Approved | SFTP / AS2 / upload: last file, errors, path, link to ingestions. |
| **F11** | Outbound delivery timeline | ✅ Approved | generated → transmitted → 997 confirmed with timestamps + channel. |
| **F12** | Calendar-aware SLAs | ❌ Declined | Over-engineering for niche audience. |
| **F13** | Notification quiet hours | ⏳ Nice-to-have | Beneficial optional feature; **not a priority**. |
| **F14** | Desktop Clerk in release builds | ✅ Approved | **ASAP** — `CLERK_SECRET_KEY` + webhook secret in GitHub release pipeline. |
| **F15** | Duplicate document compare | ✅ Approved | Side-by-side duplicate 850s/856s on same PO. |
| **F16** | Saved views / shared filters | ✅ Approved | Named filter presets beyond URL state. |
| **F17** | Escalation chains | ❌ Declined | Email list is sufficient. |
| **F18** | PagerDuty / Opsgenie | ❌ Declined | Unnecessary for monitoring app. |
| **F19** | Per-partner dictionary override UI | ✅ Approved | Form editor for non-standard / Z-segment labels. |
| **F20** | Theme toggle in settings | ✅ Approved | Move out of header into user menu / settings. |
| **F21** | Extended transaction-set support | ✅ Approved (phased) | Extend typed coverage as far as practical **without dev hell** — use incremental tiers (see Round 2 **F31**). |
| **F22** | Audit log viewer (admin) | ✅ Approved | Searchable UI for mutations. |

---

## Declined — Round 1 (for context)

| ID | Feature | Reason |
|---|---|---|
| F12 | Calendar-aware SLAs | Niche; flat SLAs sufficient |
| F17 | Escalation chains | Email list enough |
| F18 | PagerDuty / Opsgenie | Not needed for monitoring SKU |

---

## Round 2 — Pending your review

Inspired by Epicor MXC list patterns + approved lifecycle-first direction.

### Lifecycle list & homepage (core product shift)

| ID | Feature | What you'd get | Why |
|---|---|---|---|
| **F23** | **Document flow strip on list rows** | Horizontal chips: ORDER → ACK → SHIP → INV (or grocery WOR/WTR/WSH) with dates; solid = received, dashed = missing | MXC's core pattern — one glance shows where the conversation stalled. |
| **F24** | **Row alert summary + next activity** | Right column: “No alerts” / “855 missing” / “Duplicate document”; **Next activity:** “Send 855 (due …)” or “None” | Matches MXC alert + next-action columns; drives ops workflow. |
| **F25** | **Expand-in-place lifecycle detail** | Accordion or drawer on row expand: full timeline, transaction links, raw expand — without navigating away from list | Keeps list scannable; detail on demand (your expand model). |
| **F26** | **Lifecycle list filters** | Due date, date range, inbound doc type, outbound doc type, partner, alert status (like MXC sidebar) | Homepage needs filters suited to *conversations*, not ST rows. |
| **F27** | **Conversation due dates** | Store/display PO due date on lifecycle row (from 850 or partner config) | MXC shows due dates prominently; supports prioritization. |
| **F28** | **“Additional documents” indicator** | When duplicates or extra same-type docs exist: “2 additional document(s) in this conversation” | MXC shows this; pairs with F15 compare. |

### Ops dashboard & monitoring

| ID | Feature | What you'd get | Why |
|---|---|---|---|
| **F29** | **Global traffic silence widget** | Ops home card tied to F2 tier-1: “No inbound traffic in 6h” with partner breakdown | Surfaces F2 broad alert before per-partner rules fire. |
| **F30** | **Partner sort: worst-first** | Default lifecycle list sort by open alerts → missing docs → oldest stale | Ops opens app and sees problems first. |
| **F31** | **Phased transaction-set roadmap** | Tier A: typed 850/855/856/810/997 (v1). Tier B: 860/875/880 generic+headers. Tier C: warehouse 940/945 when grocery customer exists. Document in backlog, ship one tier per sprint. | F21 without dev hell — explicit scope gates. |
| **F32** | **Parse-error rollup on lifecycle row** | If any child transaction is PARSE_ERROR, show warning on conversation row linking to triage | Connects F5 to lifecycle-first home. |
| **F33** | **SLA countdown on flow strip** | “997 due in 3h” on outbound doc chip before breach | Extends F9 visually on the list row. |

### Troubleshooting & export

| ID | Feature | What you'd get | Why |
|---|---|---|---|
| **F34** | **Print / export lifecycle row** | Print-friendly row or PDF/CSV summary for partner disputes (MXC print icon) | Common ops ask: “send Sysco a status screenshot.” |
| **F35** | **Re-parse from triage** | One-click re-queue parse on FAILED/PARSE_ERROR from ingestions or expanded lifecycle | Completes F5 + F6 operator loop. |
| **F36** | **Control-number trace on expand** | ISA + ST control numbers visible in expanded row without opening full transaction | Faster “which file was this?” without extra clicks. |

### Data model & linking

| ID | Feature | What you'd get | Why |
|---|---|---|---|
| **F37** | **Invoice ↔ multi-PO linking** | When 810 references multiple POs, show all linked lifecycles | Real grocery/retail pattern; avoids orphan invoices. |
| **F38** | **Shipment ID lifecycle entry** | Search + list rows by shipment ID (856), not only PO | Some partners track by ASN/shipment, not PO. |

### Desktop & polish (lower urgency)

| ID | Feature | What you'd get | Why |
|---|---|---|---|
| **F39** | **First-run LAN URL helper** | Wizard step: detect/local IP, pre-fill Clerk authorized party + display URL for LAN users | Reduces LAN_INSTALL friction; pairs with F14. |
| **F40** | **In-app “what’s new” after update** | Desktop already has `pendingWhatsNew` — surface changelog modal post-update | You’re shipping fast; operators need to know what changed. |

---

## How to respond

Reply with **Agree / Disagree / Later** per ID (F23–F40), plus any tweaks. When Round 2 is settled, we'll group everything into sprints in `BUILD_PLAN.md` §6.
