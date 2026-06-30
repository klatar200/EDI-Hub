# Shipped — completed phases, sprints & features

**Purpose:** Historical record of everything **built and merged**. Use this to answer “was X implemented?” — not for planning new work.

**Planning new work:** [`BUILD_PLAN.md`](../BUILD_PLAN.md) · **Product overview:** [`README.md`](../README.md#features) · **AI rules:** [`AGENTS.md`](../AGENTS.md)

**Last updated:** 2026-06-30 · All **PS-0–PS-12**, **PB-1–PB-8**, phases **0–10**, **desktop D1–D9**, and **UI Build Plan U0–U2** complete.

---

## Table of contents

1. [Phase & milestone map](#1-phase--milestone-map)
2. [Product sprints (PS-0–PS-12)](#2-product-sprints-ps-0ps-12)
3. [Backlog sprints (PB-1–PB-8)](#3-backlog-sprints-pb-1pb-8)
4. [UI overhaul (Sprint A3)](#4-ui-overhaul-sprint-a3)
   - [4.1 UI Build Plan refresh — U0 / U1](#41-ui-build-plan-refresh--u0--u1)
5. [Remediation & ADRs (accepted)](#5-remediation--adrs-accepted)
6. [Feature matrix (F1–F62)](#6-feature-matrix-f1f62)
7. [Product backlog history](#7-product-backlog-history)
8. [Key deliverables summary](#8-key-deliverables-summary)

---

## 1. Phase & milestone map

| Phase | Milestone | Status |
|---|---|---|
| 0–2 | — | ✅ Scaffolding, ingestion, parser |
| 3 | **M1** | ✅ Data Hub UI |
| 4 | **M2** | ✅ Lifecycle stitching |
| 5–6 | — | ✅ Ack intelligence, partner config |
| 7 | **M3** | ✅ Monitoring & alerting |
| 8 | — | ✅ Outbound + AS2 |
| 9 | **M4** | ✅ Multi-tenant, RBAC, audit, Clerk |
| 10 | **M5** *code* | ✅ Code complete (deploy proof deferred — [`BUILD_PLAN.md` §4](../BUILD_PLAN.md#4-deploy-track--go-live-gate-deferred)) |
| Desktop | D1–D9 | ✅ LAN server installer, auto-update |
| UI overhaul | Sprint A3 | ✅ [§4](#4-ui-overhaul-sprint-a3) |
| UI Build Plan | U0, U1, U2 | ✅ [§4.1](#41-ui-build-plan-refresh--u0--u1) (U3 gated on UI-1 ✅ / UI-3 ⏳; U4–U5 open in [`docs/UI_BUILD_PLAN.md`](UI_BUILD_PLAN.md)) |
| 11–12 | **M6** | ⏳ Not started — [`BUILD_PLAN.md` §6](../BUILD_PLAN.md#6-phase-11--12--go-to-market) |

---

## 2. Product sprints (PS-0–PS-12)

| Sprint | Focus | Backlog IDs | Status |
|--------|--------|-------------|--------|
| **PS-0** | Desktop Clerk secrets in release pipeline | F14 | ✅ |
| **PS-1** | `GET /lifecycles` + homepage at `/` | F4′, F41, F44, F28, F32 | ✅ |
| **PS-2** | Expand-in-place timeline, filters, warnings, raw download | F25, F26, F9, F11, F55 | ✅ |
| **PS-3** | Ops dashboard at `/dashboard` | F1, F45–F48, F3 | ✅ |
| **PS-4** | Detection completion + run-detect UI | F2, F49, F50, F8 | ✅ |
| **PS-5** | Ingest triage + retry parse + startup reconcile | F5, F54, F6 | ✅ |
| **PS-6** | Settings hub, theme relocate, SLA toggles | F52, F20, F33, F13 | ✅ |
| **PS-7** | Channel health page + alerts polish | F10, F8, F33 | ✅ |
| **PS-8** | Typed 855/856 headers, glossary, parse feedback | F7, F31, F59, F60 | ✅ |
| **PS-9** | Ops notes, duplicate compare, lifecycle export | F15, F56, F34, F37 | ✅ |
| **PS-10** | Search lifecycle-first, saved views | F42, F16, F43 | ✅ |
| **PS-11** | Audit viewer, email digest, dictionary UI, bulk export | F22, F51, F57, F19 | ✅ |
| **PS-12** | Desktop LAN onboarding + Help menu | F39, F40, F61, F62 | ✅ |

---

## 3. Backlog sprints (PB-1–PB-8)

| Sprint | Focus | Backlog IDs | Status |
|--------|--------|-------------|--------|
| **PB-1** | Alerts + detection UI | F8, F50, F49 | ✅ |
| **PB-2** | Ingest triage polish | F53, F54, F60 | ✅ |
| **PB-3** | Dashboard completeness | F1, F3, F45 | ✅ |
| **PB-4** | Settings + SLA behavior | F13, F33 | ✅ |
| **PB-5** | Lifecycle detail richness | F7, F31, F44 | ✅ |
| **PB-6** | Export + admin polish | F58, F22, F56 | ✅ |
| **PB-7** | Extended sets productization | F21, F31 | ✅ |
| **PB-8** | Due dates, multi-PO invoice, shipment search | F27, F37, F38 | ✅ |

---

## 4. UI overhaul (Sprint A3)

**Status:** ✅ Done — gates locked **A1 / B2 / C1** (2026-06-25).

| Gate | Choice | Notes |
|---|---|---|
| **A — Accent** | **A1** indigo/slate | Brand tokens in `index.css` |
| **B — Dark mode** | **B2** light / system / dark toggle | Header `ThemeToggle`; localStorage |
| **C — Components** | **C1** shadcn on Lifecycle + Alerts | Card, StatusPill, PageHeader |

**Deliverables:** Vertical lifecycle timeline (gaps, duplicates, AK detail, inline raw); alerts row (partner chip, SLA pill, lifecycle link, ack/snooze).

### 4.1 UI Build Plan refresh — U0 / U1

**Status:** ✅ Done (2026-06-30). Companion plan: [`docs/UI_BUILD_PLAN.md`](UI_BUILD_PLAN.md). U2–U5 deferred.

**U0 — Foundations & decisions:**

| ID | Item | Evidence |
|----|------|----------|
| **ST1** | Radix `Popover` + `DropdownMenu` wrappers under `apps/web/src/components/ui` | `Popover.tsx`, `DropdownMenu.tsx` |
| **S1**  | Status-tone semantic map (one meaning per color) extracted from `StatusPill` | `apps/web/src/components/ui/status-tones.ts` |
| — | IA + component-layer ADR | [`adr/0003`](adr/0003-ui-foundations-and-component-layer.md) |

**U1 — Nav & quick wins:**

| ID | Item | Evidence |
|----|------|----------|
| **N1** | Primary nav cut to 5 destinations (Lifecycles, Dashboard, Alerts, Transactions, Partners); overflow → `More` dropdown grouped Explore / Configure / Admin | `apps/web/src/components/Layout.tsx` |
| **T1** | Lifecycles' 8 narrow-the-list filters collapsed into a Filters popover with active-count badge; Sort + Needs-attention stay inline | `apps/web/src/pages/LifecyclesPage.tsx` |
| **T5** | Sticky `DataTable` headers — `overflow-clip` outer + `lg:overflow-x-visible` inner so sticky engages with page scroll; `top-12` to clear the layout nav | `apps/web/src/components/ui/DataTable.tsx` |
| **S2** | Branched empty states on Alerts (narrowed / caught-up / pivoted-status) and inline Add-partner CTA in Partners | `AlertsPage.tsx`, `PartnersConfigPage.tsx` |
| **S3** | Single loading idiom — `Skeleton.Row` shims on every in-page data fetch (list counters, expanded timelines, raw EDI panes, server-address fetches). Boot/auth splashes deliberately exempted. | Multiple |

**U2 — Forms & detail polish:**

| ID | Item | Evidence |
|----|------|----------|
| **N5**  | Breadcrumbs primitive (`<nav><ol>` with `aria-current="page"`, arrow on first link) wired into Lifecycle and Transaction detail pages | `apps/web/src/components/ui/Breadcrumbs.tsx`, `LifecyclePage.tsx`, `TransactionDetailPage.tsx` |
| **T4**  | Edit/Delete on Partners and Remove on Users hidden behind `[@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100`; visible always on touch + in the a11y tree | `PartnersConfigPage.tsx`, `UsersPage.tsx` |
| **FO1** | Custom Tabs primitive (WAI-ARIA + arrow / Home / End nav) + partner editor regrouped into 5 tabs (Identity / Sets & flow / SLAs & alerts / Connectivity / Notes & contacts) + sticky save bar | `apps/web/src/components/ui/Tabs.tsx`, `PartnersConfigPage.tsx` |
| **FO2** | `Field` helper extended with `required` markers + inline `error`. Client `validateDraft` mirrors the server validator; API errors map server's `field` path back to the matching tab. Tab triggers carry error-count badges. | `PartnersConfigPage.tsx` |
| **FO3** | Unsaved-changes guard: `JSON.stringify` baseline of the draft, `isDirty` `useMemo`, `beforeunload` listener while dirty, `confirmDiscard()` on Cancel / Edit-another / New / Delete-current. Warn-tone "Unsaved changes" pill. | `PartnersConfigPage.tsx` |

**Gate decisions:**

- **UI-1** (monitoring landing): resolved 2026-06-30 — keep BOTH Dashboard and Lifecycles as landing pages; each user picks via Settings; default Monitoring (`/dashboard`). Reshapes N2 into a per-user preference rather than collapsing the surfaces; partially supersedes ST2.
- **UI-2** (component layer): de facto resolved — Radix (`Popover`, `DropdownMenu`) + hand-rolled (`Tabs`, `Breadcrumbs`) primitives co-exist under `apps/web/src/components/ui`. No new Radix deps added in U2.
- **UI-3** (Transactions + Ingestions): still open — N3 blocked until resolved.

---

## 5. Remediation & ADRs (accepted)

**Path A-core (done):** W1.1, W1.2, W2.1–W2.3, W3.3, W3.4 — production auth guardrails, tenant-scoped ISA dedup, multi-tenant detection, green CI, production `requireTenantId` throw, `clerk-nextjs` removed.

**Security audit SEC-1–5:** Shipped 2026-06-28 — detail in [`docs/SECURITY_AUDIT.md`](SECURITY_AUDIT.md).

| ID | Decision | ADR / evidence |
|---|---|---|
| **W3.1** | Sync ingest + startup reconcile (no BullMQ for v1) | [`adr/0001`](adr/0001-w3.1-synchronous-ingestion-with-reconcile.md) |
| **W3.2** | Same-origin default; CORS escape hatch | [`adr/0002`](adr/0002-w3.2-same-origin-default-cors-escape-hatch.md) |
| **W4.1** | Clerk reconcile script | ✅ `npm run reconcile-clerk --workspace=@edi/api` |

---

## 6. Feature matrix (F1–F62)

**Legend:** ✅ Done · ⛔ Declined

| ID | Feature | Status | Sprint |
|----|---------|--------|--------|
| F1 | Ops home dashboard | ✅ | PB-3 |
| F2 | Stale-traffic alerts | ✅ | PS-4 |
| F3 | Partner health summary | ✅ | PB-3 |
| F4′ | Lifecycle-first homepage | ✅ | PS-1 |
| F5 | Ingestion failure triage | ✅ | PS-5 |
| F6 | Startup reconcile | ✅ | PS-5 |
| F7 | Typed 855/856 headers on lifecycle | ✅ | PB-5 |
| F8 | Alert partner filter + bulk ack | ✅ | PB-1 |
| F9 | Expected-document warnings | ✅ | PS-2 |
| F10 | Channel health page | ✅ | PS-7 |
| F11 | Outbound delivery timeline | ✅ | PS-2 |
| F13 | Notification quiet hours | ✅ | PB-4 |
| F14 | Desktop Clerk in releases | ✅ | PS-0 |
| F15 | Duplicate document compare | ✅ | PS-9 |
| F16 | Saved views | ✅ | PS-10 |
| F19 | Dictionary override UI | ✅ | PS-11 |
| F20 | Theme toggle in settings | ✅ | PS-6 |
| F21 | Extended transaction sets (860/875/880) | ✅ | PB-7 |
| F22 | Audit log viewer | ✅ | PB-6 |
| F25 | Expand-in-place lifecycle | ✅ | PS-2 |
| F26 | Lifecycle list filters | ✅ | PS-2 |
| F27 | Conversation due dates | ✅ | PB-8 |
| F28 | Additional documents indicator | ✅ | PS-1 |
| F29 | Global traffic silence widget | ✅ | F45 / PS-3 |
| F31 | Phased transaction-set roadmap | ✅ | PB-5 |
| F32 | Parse-error rollup | ✅ | PS-1 |
| F33 | SLA countdown on row | ✅ | PB-4 |
| F34 | Export lifecycle | ✅ | PS-9 |
| F35 | Re-parse from triage | ✅ | F54 / PS-5 |
| F37 | Multi-PO invoice linking | ✅ | PB-8 |
| F38 | Shipment ID entry | ✅ | PB-8 |
| F39 | First-run LAN URL helper | ✅ | PS-12 |
| F40 | What's new after update | ✅ | PS-12 |
| F41 | Lifecycle row status summary | ✅ | PS-1 |
| F42 | Search → lifecycle first | ✅ | PS-10 |
| F43 | Pinned / watchlist POs | ✅ | PS-10 |
| F44 | Lifecycle list default sort | ✅ | PB-5 |
| F45 | Traffic silence card | ✅ | PB-3 |
| F46 | Open alerts summary card | ✅ | PS-3 |
| F47 | Ingest health card | ✅ | PS-3 |
| F48 | Rejection sparkline | ✅ | PS-3 |
| F49 | Unknown ISA sender alert | ✅ | PB-1 |
| F50 | Run detection from UI | ✅ | PB-1 |
| F51 | Email digest | ✅ | PS-11 |
| F52 | Settings hub | ✅ | PS-6 |
| F53 | Duplicate file explanation | ✅ | PB-2 |
| F54 | Retry parse | ✅ | PB-2 |
| F55 | Raw download from expand | ✅ | PS-2 |
| F56 | Ops notes on lifecycle | ✅ | PB-6 |
| F57 | Bulk export | ✅ | PS-11 |
| F58 | Export includes raw EDI | ✅ | PB-6 |
| F59 | Transaction set glossary | ✅ | PS-8 |
| F60 | Parser improvement feedback | ✅ | PB-2 |
| F61 | Help menu docs | ✅ | PS-12 |
| F62 | Copy LAN URL anytime | ✅ | PS-12 |
| F12, F17, F18, F23, F24, F30, F36 | — | ⛔ Declined | — |

---

## 7. Product backlog history

### Round 1 — Approved (all shipped)

F1–F22 as in matrix above. **Declined:** F12, F17, F18.

### Round 2 — Decisions (resolved)

| ID | Feature | Decision |
|---|---|---|
| F23, F24, F30, F36 | Various UI ideas | ⛔ Declined |
| F25–F35, F37–F40 | Lifecycle, export, desktop | ✅ Approved → shipped |

### Round 3 — Approved (all shipped)

F41–F62 — see [§6](#6-feature-matrix-f1f62).

<details>
<summary>Clarifications — F27, F29, F35, F38</summary>

**F27:** Due dates from 850 DTM on lifecycle rows (PB-8).

**F29:** Traffic silence → shipped as F45 dashboard card.

**F35 / F54:** Retry parse from triage / expanded lifecycle (PS-5, PB-2).

**F38:** Shipment via `GET /lifecycle?shipment=` + search (PB-8).

</details>

---

## 8. Key deliverables summary

- Homepage = paginated lifecycle list, expand-in-place timeline, filters, saved views, pins, SLA, due dates
- Ops dashboard, alerts, channel health, settings hub
- Search → lifecycle first; invoice/shipment entry; multi-PO invoice on 810/880
- Export (txt/csv/pdf, bulk ZIP, raw EDI); audit viewer; email digest; ops notes
- Transaction sets: 850, 855, 856, 810, 997 + Tier B 860/875/880
- Desktop: LAN wizard, Help hub, Clerk in releases, auto-update
