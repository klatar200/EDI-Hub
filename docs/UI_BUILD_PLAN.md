# UI/UX Build Plan

**Owner:** Keagan  
**Status:** ✅ **Complete** — all phases **U0–U5** shipped (2026-06-30). No open UI phases.  
**Purpose:** Historical traceability for the UI/UX review recommendations. **Do not add new UI sprint work here.**

> **Shipped evidence:** [`docs/SHIPPED.md` §4.1](SHIPPED.md#41-ui-build-plan-refresh--u0u5) · **What's next (product):** [`BUILD_PLAN.md`](../BUILD_PLAN.md) · **Optional future polish:** [`BUILD_PLAN.md` §5](../BUILD_PLAN.md#5-future--optional-features)

---

## What's left

The UI Build Plan is **finished**. Remaining work is **not UI-plan scoped**:

| Track | Where | Examples |
|-------|--------|----------|
| Local validation | [`BUILD_PLAN.md` §2](../BUILD_PLAN.md#2-active-track--local-validation-0) | `npm run validate:local`, end-to-end ingest smoke |
| Go-live / staging | [`BUILD_PLAN.md` §4](../BUILD_PLAN.md#4-deploy-track--go-live-gate-deferred) | Terraform, RDS, M5 ops proof |
| Commercial | [`BUILD_PLAN.md` §6](../BUILD_PLAN.md#6-phase-11--12--go-to-market) | Phase 11–12 |
| Optional polish | [`BUILD_PLAN.md` §5](../BUILD_PLAN.md#5-future--optional-features) | W4.2 raw viewing, desktop boot noise, Tier C sets |

Only item **declined** from this plan (not deferred): **ST2** role-aware landing (superseded by UI-1 default-landing preference).

---

## Principles (carried over from the product plan)

1. **Every phase ends in something demoable** — no phase is "done" until you can show it.
2. **Reuse tokens + `ui/` components.** No bespoke colors or one-off spacing; extend the design system, don't fork it.
3. **Don't regress tests.** Each phase updates vitest specs and the Playwright **parity snapshots** (`npm run test:parity:update`) and must leave `npm run test:ci` green.
4. **Anti-drift.** If an item grows a backend dependency, stop and flag it — most of this is presentation only.

**Effort key:** `S` ≈ <0.5 day · `M` ≈ 0.5–2 days · `L` ≈ 2–4 days (solo, with Opus codegen; includes test + snapshot updates).
**Status key:** ✅ Done · 🚧 In flight · ⏳ Pending · ⛔ Declined.

---

## Recommendation index (traceability)

| ID | Recommendation | Status |
|----|----------------|--------|
| **N1** | Cut primary nav to ~5 destinations | ✅ |
| **N2** | Consolidate overlapping monitoring surfaces (Dashboard/Lifecycles/Alerts/Metrics/Channels) | ✅ — reframed by UI-1 as a per-user preference (Default landing). Surfaces stay as peers. |
| **N3** | Clarify / merge Transactions vs Ingestions | ✅ — merged into `/documents` with `view=parsed\|raw` toggle. |
| **N4** | Command palette (Cmd-K) | ✅ |
| **N5** | Breadcrumbs / back affordance on detail pages | ✅ |
| **T1** | Collapse Lifecycles filter row into a Filters popover | ✅ |
| **T2** | Saved views as segmented tabs | ✅ |
| **T3** | Column + density controls on big tables | ✅ |
| **T4** | Hover-revealed row actions | ✅ |
| **T5** | Sticky table headers | ✅ |
| **FO1** | Partner editor → tabs/accordion + sticky save bar | ✅ |
| **FO2** | Inline field validation + required markers | ✅ |
| **FO3** | Unsaved-changes guard | ✅ |
| **S1** | Status color/token audit (one meaning per color) | ✅ |
| **S2** | Empty states with a next action everywhere | ✅ |
| **S3** | One loading idiom (Skeleton everywhere) | ✅ |
| **O1** | Inline EDI jargon tooltips | ✅ |
| **O2** | Persistent setup-progress indicator | ✅ |
| **AC1** | Accessibility pass | ✅ |
| **AC2** | Mobile card-view fallback for dense tables | ✅ |
| **ST1** | Standardize on one component layer (shadcn/Radix) | ✅ — Radix (`Popover`, `DropdownMenu`, `Tooltip`) + hand-rolled (`Tabs`, `Breadcrumbs`, `CommandPalette`) under `apps/web/src/components/ui`. |
| **ST2** | Role-aware landing page | ⛔ — declined per UI-1 (global default = Monitoring; user opt-in via Settings). |
| **ST3** | Header alert bell | ✅ |

---

## Decision Gates

All three gates resolved. Decisions captured in [`docs/SHIPPED.md` §4.1](SHIPPED.md#41-ui-build-plan-refresh--u0u5).

- **Gate UI-1 — Monitoring landing.** ✅ Resolved 2026-06-30. Keep BOTH Dashboard and Lifecycles as landing pages; each user picks via Settings; default = Monitoring (`/dashboard`). Reshapes N2 into a per-user preference instead of collapsing surfaces. Implementation: `apps/web/src/AppRoutes.tsx` `DefaultLanding` + `SettingsPage.tsx` `DefaultLandingCard` + `defaultLanding` field on the existing `/preferences` API.
- **Gate UI-2 — Component layer.** ✅ Resolved during U0–U5. Radix (`Popover`, `DropdownMenu`, `Tooltip`) for interactive primitives; hand-rolled (`Tabs`, `Breadcrumbs`, `CommandPalette`, `Skeleton`) for the rest. All primitives live under `apps/web/src/components/ui/`.
- **Gate UI-3 — Transactions + Ingestions.** ✅ Resolved 2026-06-30. Merge into one `/documents` explorer with a `view=parsed\|raw` query toggle. Old `/transactions` and `/ingestions` routes redirect (preserving filter query params). Detail routes (`/transactions/:id`) unchanged.

---

## Phase U0 — Foundations & decisions ✅

**Goal:** lock the cross-cutting decisions and tokens so every later phase is consistent.
**Effort:** ~1 week.
**Status:** ✅ Shipped (2026-06-30).

| ID | Item | Approach | Effort | Status |
|----|------|----------|--------|--------|
| **S1** | Status token audit | Inventory every `StatusPill` tone in use; define a semantic map (severity vs status vs setup) and document it next to the tokens. | M | ✅ `apps/web/src/components/ui/status-tones.ts` |
| **ST1** | Component-layer spike (Gate UI-2) | Scaffold shadcn/Radix Dialog, Tabs, Popover, Command, Tooltip, DropdownMenu; wrap in `ui/` so the rest of the app imports locally. | M | ✅ Pragmatic mix landed: Radix Popover + DropdownMenu, hand-rolled Tabs + Breadcrumbs |
| — | IA ADR (Gates UI-1 + UI-3) | One-page ADR fixing the target nav, surface consolidation, and the Documents decision. | S | ✅ [`docs/adr/0003`](adr/0003-ui-foundations-and-component-layer.md) |

**Exit:** ADR signed; semantic color map documented; primitives available under `ui/`.

---

## Phase U1 — Navigation & quick wins ✅

**Goal:** remove the most visible clutter. Pairs directly with your "do these first" picks.
**Effort:** ~1 week.
**Status:** ✅ Shipped (2026-06-30).

| ID | Item | Approach | Effort | Status |
|----|------|----------|--------|--------|
| **N1** | Nav restructure | Reduce to ~5 primary destinations; push the rest into a labeled overflow / Configure menu. Preserves existing `data-testid`s. | M | ✅ Primary nav cut to 5; "More" Dropdown menu groups Explore / Configure / Admin. `Layout.tsx` |
| **T1** | Lifecycles filter popover | Move the ~10 inline filters into a "Filters" popover with an active-count badge; keep Needs-attention + search inline. | M | ✅ 8 narrowing filters in `Popover` + active-count badge. `LifecyclesPage.tsx` |
| **T5** | Sticky table headers | `position: sticky` headers on the long lists (Lifecycles, Transactions, Ingestions). | S | ✅ `DataTable.Thead` sticky `top-12`, `overflow-clip` outer + `lg:overflow-x-visible` inner |
| **S2** | Empty states everywhere | Extend the Lifecycles "nothing yet + do X" pattern to Alerts, Partners, Transactions, Ingestions. | S–M | ✅ Branched Alerts (narrowed / caught-up / status-pivot) + inline Add-partner CTA |
| **S3** | One loading idiom | Replace any "Loading…" text with the `Skeleton` component across pages. | S | ✅ All in-page data fetches use `Skeleton.Row`. Boot/auth splashes intentionally exempted. |

**Exit:** ≤5 primary nav items; Lifecycles filter bar collapsed; consistent empty/loading states.

---

## Phase U2 — Forms & detail polish ✅

**Goal:** make the heaviest editing surfaces and detail pages navigable.
**Effort:** ~1–1.5 weeks.
**Status:** ✅ Shipped (2026-06-30).

| ID | Item | Approach | Effort | Status |
|----|------|----------|--------|--------|
| **FO1** | Partner editor tabs | Split the 9-section form into Tabs (Identity / Sets & flow / SLAs & alerts / Connectivity / Notes & contacts) with a sticky save bar. | M–L | ✅ Custom `Tabs` primitive + 5-tab editor + `sticky bottom-0` save bar |
| **FO2** | Inline validation | Surface field-level errors + required markers; stop relying on the bottom-of-form banner. | M | ✅ Client `validateDraft` mirrors server validator; server `field` path routes to right tab; tab triggers carry error-count badges |
| **FO3** | Unsaved-changes guard | Prompt on route-leave (or autosave a draft) when an editor is dirty. | S–M | ✅ `JSON.stringify` baseline + `isDirty` + `beforeunload` listener + `confirmDiscard()` on Cancel / Edit-another / New / Delete-current. Known limit: in-app `NavLink` navigation isn't blocked (would need `createBrowserRouter`). |
| **N5** | Breadcrumbs / back | Add a breadcrumb + back affordance on Lifecycle and Transaction detail. | S | ✅ `Breadcrumbs` primitive wired into both detail pages |
| **T4** | Hover row actions | Reveal Edit/Delete on row hover (Partners, others) instead of always-on. | S | ✅ `[@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100` on Partners + Users. Always-visible on touch + in a11y tree. |

**Exit:** partner editor tabbed with sticky save; inline validation; detail pages have an "up" path.

---

## Phase U3 — Information architecture consolidation ✅

**Goal:** collapse the overlapping "is everything OK?" surfaces into a coherent hierarchy.
**Effort:** ~1.5–2 weeks.
**Status:** ✅ Shipped (2026-06-30). Reshaped by gate decisions.

| ID | Item | Approach | Effort | Status |
|----|------|----------|--------|--------|
| **N2** | Consolidate monitoring surfaces | Per Gate UI-1: one landing with drill-downs into Alerts/Metrics/Channels rather than five peer pages. | L | ✅ Reframed by UI-1: kept Dashboard / Lifecycles / Alerts / Metrics / Channels as peers; added per-user "Default landing page" preference (default Monitoring). |
| **N3** | Documents explorer | Per Gate UI-3: merge Transactions + Ingestions into one "Documents" view with a raw/parsed toggle, or relabel both clearly. | M–L | ✅ `/documents` with segmented Tabs toggle. `/transactions` and `/ingestions` redirect, preserving filter query params. |
| **ST2** | Role-aware landing | Route execs to a summary view and ops to the triage queue, using existing RBAC. | M | ⛔ Declined per UI-1 (global default = Monitoring for everyone; users opt-in to Lifecycles via Settings). Could be revisited as a fallback when a user has no preference set. |

**Exit:** Default landing preference shipped; documents unified behind one route + toggle.

---

## Phase U4 — Power features ✅

**Goal:** speed for daily operators; reduce reliance on the nav bar.
**Effort:** ~1.5 weeks.
**Status:** ✅ Shipped 2026-06-30 — N4, T2, T3, ST3 complete.

| ID | Item | Approach | Effort | Status |
|----|------|----------|--------|--------|
| **N4** | Command palette (Cmd-K) | Fuzzy jump to any PO, partner, page, or action (uses the ST1 Command primitive + existing search API). | M–L | ✅ Custom `CommandPalette` + `useCommandPaletteHotkey`. Static pages filter inline; debounced `/search` populates Lifecycle / Transaction / Raw-file sections. Header "Jump to… ⌘K" hint button. |
| **T2** | Saved-view tabs | Render saved lifecycle views as segmented tabs ("All / Needs attention / Mine") at the top of the list. | M | ✅ `LifecycleViewTabs` at top of filter card; Mine uses `pinnedOnly` + `pinnedPos`; custom views stay in `SavedViewsBar`. |
| **T3** | Column + density controls | Per-user column hide/show + comfortable/compact toggle on Transactions and Lifecycles (persist in preferences). | M | ✅ `TableDisplayMenu` + `UserPreferences.tablePrefs`; `DataTable` `density` prop. |
| **ST3** | Header alert bell | Unread-count bell with a quick peek + ack, complementing the Alerts page. | M | ✅ `AlertBell` in layout header; peek top 5 active alerts; ops can ack inline. |

**Exit:** Cmd-K navigates; saved-view tabs; column/density prefs persist; alert bell live.

---

## Phase U5 — Guidance, accessibility & responsive ✅

**Goal:** lower the EDI learning curve and meet a11y / mobile basics.
**Effort:** ~1.5–2 weeks.
**Status:** ✅ Shipped 2026-06-30 — O1, O2, AC1, AC2 complete.

| ID | Item | Approach | Effort | Status |
|----|------|----------|--------|--------|
| **O1** | Inline jargon tooltips | Hover-definitions for 850/855/856/810/997, ISA, AK5 inline (uses ST1 Tooltip + existing glossary content). | M | ✅ `@radix-ui/react-tooltip` + `EdiTerm`; canonical `EDI_GLOSSARY` in `@edi/shared`; wired into timeline, transaction detail, mobile cards, Help glossary. |
| **O2** | Setup-progress indicator | Persistent "Setup: 2/4" until partner + ISA IDs + channel configured; builds on the onboarding checklist + `partnerSetupStatus`. | S–M | ✅ `hubSetupStatus` + `SetupProgressIndicator` in layout header; popover checklist links to fix routes. |
| **AC1** | Accessibility pass | Focus rings, aria-labels on icon-only buttons, dark-mode contrast, keyboard nav for tables/menus/dialogs. | M–L | ✅ Global `focus-visible` already in `index.css`; added aria-labels on table column menu, saved-view delete, ingestion mobile actions; Radix Tooltip keyboard-focusable. |
| **AC2** | Mobile table fallback | Card-view layout for dense tables below `md`. | M–L | ✅ `LifecycleMobileCards`, `TransactionMobileCards`, `IngestionMobileCards` via `useMaxMd()`; desktop keeps `DataTable`. |

**Exit:** jargon explained inline; visible setup progress; a11y + mobile basics in place.

---

## Master sequencing table

| Phase | Items | Theme | Gate dependency | Status |
|-------|-------|-------|-----------------|--------|
| **U0** | S1, ST1, IA ADR | Foundations & decisions | resolves UI-1/2/3 | ✅ |
| **U1** | N1, T1, T5, S2, S3 | Nav & quick wins | — | ✅ |
| **U2** | FO1, FO2, FO3, N5, T4 | Forms & detail polish | — | ✅ |
| **U3** | N2, N3, ST2 | IA consolidation | UI-1, UI-3 | ✅ |
| **U4** | N4, T2, T3, ST3 | Power features | UI-2 (for N4) | ✅ |
| **U5** | O1, O2, AC1, AC2 | Guidance, a11y, responsive | UI-2 (for O1) | ✅ |

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
- **Known UX limits documented inline** (not silently swept):
  - **FO3**: in-app `NavLink` navigation isn't blocked by the dirty-draft guard. `useBlocker` needs `createBrowserRouter`, which this app doesn't use. `beforeunload` covers tab close / refresh; the four explicit close-paths cover the realistic in-page loss vectors.
  - **T5**: sticky header `top-12` is hard-coded to clear the layout nav. If the nav grows / shrinks meaningfully, update both together.
