# UI/UX Build Plan

**Owner:** Keagan
**Status:** Draft — sequencing proposed; Decision Gates UI-1…UI-3 open
**Purpose:** Implement the UI/UX review recommendations as a sequenced, demoable plan, consistent with the project's existing phase conventions.

> Companion to [`BUILD_PLAN.md`](../BUILD_PLAN.md). This plan is **UI-only unless an item is explicitly flagged "backend"**. Most items reuse the existing CSS-var tokens and `apps/web/src/components/ui` primitives.

---

## Principles (carried over from the product plan)

1. **Every phase ends in something demoable** — no phase is "done" until you can show it.
2. **Reuse tokens + `ui/` components.** No bespoke colors or one-off spacing; extend the design system, don't fork it.
3. **Don't regress tests.** Each phase updates vitest specs and the Playwright **parity snapshots** (`npm run test:parity:update`) and must leave `npm run test:ci` green.
4. **Anti-drift.** If an item grows a backend dependency, stop and flag it — most of this is presentation only.

**Effort key:** `S` ≈ <0.5 day · `M` ≈ 0.5–2 days · `L` ≈ 2–4 days (solo, with Opus codegen; includes test + snapshot updates).

---

## Recommendation index (traceability)

| ID | Recommendation |
|----|----------------|
| **N1** | Cut primary nav to ~5 destinations |
| **N2** | Consolidate overlapping monitoring surfaces (Dashboard/Lifecycles/Alerts/Metrics/Channels) |
| **N3** | Clarify / merge Transactions vs Ingestions |
| **N4** | Command palette (Cmd-K) |
| **N5** | Breadcrumbs / back affordance on detail pages |
| **T1** | Collapse Lifecycles filter row into a Filters popover |
| **T2** | Saved views as segmented tabs |
| **T3** | Column + density controls on big tables |
| **T4** | Hover-revealed row actions |
| **T5** | Sticky table headers |
| **FO1** | Partner editor → tabs/accordion + sticky save bar |
| **FO2** | Inline field validation + required markers |
| **FO3** | Unsaved-changes guard |
| **S1** | Status color/token audit (one meaning per color) |
| **S2** | Empty states with a next action everywhere |
| **S3** | One loading idiom (Skeleton everywhere) |
| **O1** | Inline EDI jargon tooltips |
| **O2** | Persistent setup-progress indicator |
| **AC1** | Accessibility pass |
| **AC2** | Mobile card-view fallback for dense tables |
| **ST1** | Standardize on one component layer (shadcn/Radix) |
| **ST2** | Role-aware landing page |
| **ST3** | Header alert bell |

---

## Decision Gates (resolve before the dependent phase)

- **Gate UI-1 — Monitoring consolidation (blocks U3 / N2 / ST2).** Make **Dashboard** the single landing with drill-downs, *or* merge Dashboard into the Lifecycles home. Determines how many "overview" surfaces survive.
- **Gate UI-2 — Component layer (blocks U0 exit; influences N4, FO1, O1, S1).** Adopt **shadcn/Radix** primitives (Dialog, Tabs, Popover, Command, Tooltip, DropdownMenu) as the standard, or keep bespoke components. You already use shadcn in spots — this decides whether to commit.
- **Gate UI-3 — Transactions + Ingestions (blocks U3 / N3).** Merge into one **"Documents"** explorer with a raw/parsed toggle, or keep two pages with clearer labels.

---

## Phase U0 — Foundations & decisions

**Goal:** lock the cross-cutting decisions and tokens so every later phase is consistent.
**Effort:** ~1 week.

| ID | Item | Approach | Effort |
|----|------|----------|--------|
| **S1** | Status token audit | Inventory every `StatusPill` tone in use; define a semantic map (severity vs status vs setup) and document it next to the tokens. | M |
| **ST1** | Component-layer spike (Gate UI-2) | Scaffold shadcn/Radix Dialog, Tabs, Popover, Command, Tooltip, DropdownMenu; wrap in `ui/` so the rest of the app imports locally. | M |
| — | IA ADR (Gates UI-1 + UI-3) | One-page ADR fixing the target nav, surface consolidation, and the Documents decision. | S |

**Exit:** ADR signed; semantic color map documented; primitives available under `ui/`.
**Demo:** a sample page showing the chosen primitives and the status-token map.

---

## Phase U1 — Navigation & quick wins (highest ROI, low risk)

**Goal:** remove the most visible clutter. Pairs directly with your "do these first" picks.
**Effort:** ~1 week.

| ID | Item | Approach | Effort |
|----|------|----------|--------|
| **N1** | Nav restructure | Reduce to ~5 primary destinations; push the rest into a labeled overflow / Configure menu. Preserves existing `data-testid`s. | M |
| **T1** | Lifecycles filter popover | Move the ~10 inline filters into a "Filters" popover with an active-count badge; keep Needs-attention + search inline. | M |
| **T5** | Sticky table headers | `position: sticky` headers on the long lists (Lifecycles, Transactions, Ingestions). | S |
| **S2** | Empty states everywhere | Extend the Lifecycles "nothing yet + do X" pattern to Alerts, Partners, Transactions, Ingestions. | S–M |
| **S3** | One loading idiom | Replace any "Loading…" text with the `Skeleton` component across pages. | S |

**Exit:** ≤5 primary nav items; Lifecycles filter bar collapsed; consistent empty/loading states.
**Demo:** new nav + the Filters popover on Lifecycles.

---

## Phase U2 — Forms & detail polish

**Goal:** make the heaviest editing surfaces and detail pages navigable.
**Effort:** ~1–1.5 weeks.

| ID | Item | Approach | Effort |
|----|------|----------|--------|
| **FO1** | Partner editor tabs | Split the 9-section form into Tabs (Identity / Sets & flow / SLAs & alerts / Connectivity / Notes & contacts) with a sticky save bar. | M–L |
| **FO2** | Inline validation | Surface field-level errors + required markers; stop relying on the bottom-of-form banner. | M |
| **FO3** | Unsaved-changes guard | Prompt on route-leave (or autosave a draft) when an editor is dirty. | S–M |
| **N5** | Breadcrumbs / back | Add a breadcrumb + back affordance on Lifecycle and Transaction detail. | S |
| **T4** | Hover row actions | Reveal Edit/Delete on row hover (Partners, others) instead of always-on. | S |

**Exit:** partner editor tabbed with sticky save; inline validation; detail pages have an "up" path.
**Demo:** partner editor walkthrough.

---

## Phase U3 — Information architecture consolidation *(needs Gates UI-1, UI-3)*

**Goal:** collapse the overlapping "is everything OK?" surfaces into a coherent hierarchy.
**Effort:** ~1.5–2 weeks.

| ID | Item | Approach | Effort |
|----|------|----------|--------|
| **N2** | Consolidate monitoring surfaces | Per Gate UI-1: one landing with drill-downs into Alerts/Metrics/Channels rather than five peer pages. | L |
| **N3** | Documents explorer | Per Gate UI-3: merge Transactions + Ingestions into one "Documents" view with a raw/parsed toggle, or relabel both clearly. | M–L |
| **ST2** | Role-aware landing | Route execs to a summary view and ops to the triage queue, using existing RBAC. | M |

**Exit:** a single clear monitoring home; documents unified or clearly distinguished; role-based default route.
**Demo:** exec vs ops landing side by side.

---

## Phase U4 — Power features

**Goal:** speed for daily operators; reduce reliance on the nav bar.
**Effort:** ~1.5 weeks.

| ID | Item | Approach | Effort |
|----|------|----------|--------|
| **N4** | Command palette (Cmd-K) | Fuzzy jump to any PO, partner, page, or action (uses the ST1 Command primitive + existing search API). | M–L |
| **T2** | Saved-view tabs | Render saved lifecycle views as segmented tabs ("All / Needs attention / Mine") at the top of the list. | M |
| **T3** | Column + density controls | Per-user column hide/show + comfortable/compact toggle on Transactions and Lifecycles (persist in preferences). | M |
| **ST3** | Header alert bell | Unread-count bell with a quick peek + ack, complementing the Alerts page. | M |

**Exit:** Cmd-K navigates; saved-view tabs; column/density prefs persist; alert bell live.
**Demo:** Cmd-K + alert bell.

---

## Phase U5 — Guidance, accessibility & responsive

**Goal:** lower the EDI learning curve and meet a11y / mobile basics.
**Effort:** ~1.5–2 weeks.

| ID | Item | Approach | Effort |
|----|------|----------|--------|
| **O1** | Inline jargon tooltips | Hover-definitions for 850/855/856/810/997, ISA, AK5 inline (uses ST1 Tooltip + existing glossary content). | M |
| **O2** | Setup-progress indicator | Persistent "Setup: 2/4" until partner + ISA IDs + channel configured; builds on the onboarding checklist + `partnerSetupStatus`. | S–M |
| **AC1** | Accessibility pass | Focus rings, aria-labels on icon-only buttons, dark-mode contrast, keyboard nav for tables/menus/dialogs. | M–L |
| **AC2** | Mobile table fallback | Card-view layout (or explicit horizontal-scroll affordance) for dense tables below `md`. | M–L |

**Exit:** jargon explained inline; visible setup progress; a11y + mobile basics in place.
**Demo:** keyboard-only and mobile walkthroughs.

---

## Master sequencing table

| Phase | Items | Theme | Gate dependency |
|-------|-------|-------|-----------------|
| **U0** | S1, ST1, IA ADR | Foundations & decisions | resolves UI-1/2/3 |
| **U1** | N1, T1, T5, S2, S3 | Nav & quick wins | — |
| **U2** | FO1, FO2, FO3, N5, T4 | Forms & detail polish | — |
| **U3** | N2, N3, ST2 | IA consolidation | UI-1, UI-3 |
| **U4** | N4, T2, T3, ST3 | Power features | UI-2 (for N4) |
| **U5** | O1, O2, AC1, AC2 | Guidance, a11y, responsive | UI-2 (for O1) |

**Total:** ~7–9 weeks at 15–25 hrs/week, with U1–U2 delivering the bulk of the visible improvement in the first ~2 weeks.

---

## Sequencing rationale

- **U0 first** because the component-layer and color-token decisions are upstream of almost everything else; choosing them late means rework in U2/U4/U5.
- **U1 before U2** — the nav and filter clutter are the loudest problems and the cheapest to fix; ship them while decisions settle.
- **U3 gated** — consolidating the monitoring surfaces is a genuine product decision (your call, not the framework's), so it waits on the ADR.
- **U4/U5 last** — high value but additive; they build on the U0 primitives and don't block daily use.

## Testing & rollout notes

- Every phase: update vitest specs for changed components, regenerate Playwright parity snapshots (`npm run test:parity:update`), and keep `npm run test:ci` green.
- The nav (N1) and any layout/IA change will churn parity snapshots — review the diff, don't blind-accept.
- Backend touchpoints are minimal: **T3** (persist column/density prefs) and **ST3** (alert-bell unread feed) reuse the existing preferences + alerts endpoints; flag anything beyond that before building.
