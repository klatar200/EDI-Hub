# UI Responsiveness Plan

**Owner:** Keagan  
**Status:** ✅ **Complete** — UR0–UR7 shipped. All catalog items **R1–R60** approved except **R6** declined.  
**Scope:** Web app (`apps/web`) and desktop app (Electron loads the same bundle via `DesktopLanRoot` / `App`).  
**Purpose:** Make the hub **use the full window** at every size — fluid shell, adaptive nav, and page-level layouts — without regressing U0–U5 shipped work.

> **Shipped baseline:** [`docs/SHIPPED.md` §4.1](SHIPPED.md#41-ui-build-plan-refresh--u0u5) (mobile cards on 3 list pages, `useMaxMd`, a11y pass).  
> **Product track:** [`BUILD_PLAN.md`](../BUILD_PLAN.md) · **Archive (prior UI work):** [`docs/UI_BUILD_PLAN.md`](UI_BUILD_PLAN.md)

---

## Problem (today)

| Symptom | Root cause (code) |
|---------|-------------------|
| Content feels the same width on a 27″ monitor and a resized laptop window | Global `max-w-[1400px] mx-auto` on header + `<main>` in `Layout.tsx` — content **letterboxes** and never grows past 1400px |
| Narrow / resized windows clip or crowd the header | Fixed `SearchBox` `w-64`, single-row header with Clerk controls + hamburger, no wrap below `lg` |
| Tables awkward on tablet widths | Mobile **cards** only on Lifecycles / Transactions / Ingestions below **767px**; other tables use horizontal scroll until **1024px** (`DataTable` `lg:overflow-x-visible`) |
| Partner editor feels “desktop-only” | `grid-cols-12` sub-forms with no `md:` / `lg:` collapse |
| Page titles fight action buttons on narrow screens | `PageHeader` always `flex justify-between`; actions use `shrink-0` |
| Desktop window resizes but layout doesn’t “breathe” | Same React shell as web; Electron default **1280×800**, no `minWidth`/`minHeight` guardrails |

**Note:** Electron **does** resize the `BrowserWindow`; the **web layout** caps and fixed widths are what make the UI feel static.

---

## Principles

1. **Fluid by default** — shell width and gutters scale with viewport unless a readable line-length cap is intentional (prose, modals).
2. **One breakpoint story** — align JS hooks (`useMaxMd`) with Tailwind breakpoints; document the chosen “card vs table” threshold once.
3. **Progressive disclosure** — hide or collapse chrome before shrinking data below usability (nav drawer, filter popovers). **Search stays always visible** (owner declined icon-expand search — see R6).
4. **Shared tokens** — layout max-width and gutters live in `index.css` `@theme`, not scattered `max-w-[1400px]`.
5. **Desktop = web** — no forked layout; Electron-only tweaks (min size, saved bounds) stay in `apps/desktop`.
6. **Demoable phases** — each phase ends in something you can resize and screenshot; `npm run test:ci` + parity snapshots stay green.

**Effort key:** `S` ≈ &lt;0.5 day · `M` ≈ 0.5–2 days · `L` ≈ 2–4 days (includes tests/snapshots).  
**Decision key:** ⏳ Pending · ✅ OK · ⛔ Declined

---

## How to decide (round 2)

Round 2 closed **2026-06-30** — owner OK'd **R38–R60**. After UR7 ships, add new items as a catalog addendum (R61+), not by reopening declined IDs.

---

## Recommendation catalog — round 1 (approved)

### A — Shell & global layout

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R1** | **Fluid shell max-width** | Replace hard `max-w-[1400px]` with a tokenized cap (e.g. `w-full max-w-[var(--layout-max)]` where `--layout-max` is `min(100% - gutters, 1600px)` or `screen-2xl`) so wide windows use more horizontal space while keeping ultra-wide readability. | M | ✅ |
| **R2** | **Responsive gutters** | Scale horizontal padding: `px-4 sm:px-6 lg:px-8` on header and main so small windows gain usable width. | S | ✅ |
| **R3** | **Layout CSS tokens** | Add `--layout-max-width`, `--layout-gutter`, `--header-height` to `@theme` in `index.css`; consume from `Layout`, `DataTable` sticky offset, and modals. | S | ✅ |
| **R4** | **Full-bleed sections (opt-in)** | Allow specific blocks (e.g. dashboard chart row, raw EDI viewer) to break out to viewport edges via a `FullBleed` wrapper while keeping page titles in the constrained column. | M | ✅ |

### B — Header & navigation

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R5** | **Responsive header layout** | Below `xl`, allow header to wrap to two rows or split brand/nav vs utilities so Clerk + search + bell + hamburger don’t overflow. Search keeps fixed `w-64` field (R6 declined). | M | ✅ |
| **R6** | **Adaptive search (icon expand)** | Replace fixed `w-64` with expandable search icon below `md`. | M | ⛔ |
| **R7** | **Progressive chrome collapse** | Ladder of visibility: hide Cmd-K label → icon-only org hint → collapse setup pill to icon — at `sm` / `md` / `lg` breakpoints. | M | ✅ |
| **R8** | **Mobile nav drawer** | Replace `<details>` hamburger with slide-over sheet (Radix `Dialog` or new `Sheet` primitive): scrollable links, larger touch targets, focus trap. | M | ✅ |
| **R9** | **Sticky offset sync** | Drive `DataTable` `thead` `top-*` from `--header-height` (updated when header wraps) so sticky headers don’t hide under nav. | S | ✅ |

### C — Page chrome

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R10** | **Responsive PageHeader** | Stack `flex-col gap-4 sm:flex-row sm:items-start sm:justify-between`; allow actions to `flex-wrap` instead of `shrink-0` only. | S | ✅ |
| **R11** | **App footer strip** | Slim footer (version, Help link, optional “LAN mode” badge on desktop) — uses bottom space on tall windows without affecting data pages. | S | ✅ |
| **R12** | **Breadcrumb truncation** | Middle crumbs collapse to `…` with tooltip on narrow screens; keep current page + parent visible. | S | ✅ |

### D — Tables & lists

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R13** | **Single card/table breakpoint** | Align `useMaxMd` with Tailwind `md` (768px) **or** standardize on `lg` (1024px) for all list pages — eliminates awkward 768–1023px “scroll table” band. | M | ✅ |
| **R14** | **Mobile cards — remaining tables** | Add card layouts for Partners, Users, Audit, Metrics, Search results, Dashboard failure tables (same pattern as `MobileTableCards.tsx`). | L | ✅ |
| **R15** | **Scroll affordance on wide tables** | Edge gradient or “scroll →” hint on `DataTable` when `scrollWidth > clientWidth` (tablet/desktop narrow). | S | ✅ |
| **R16** | **Auto-compact density** | Below `md`, default table density to `compact` unless user preference overrides (`UserPreferences.tablePrefs`). | S | ✅ |
| **R17** | **Responsive column presets** | Per-page default hidden columns below `lg` (e.g. Partners: hide GS ID until desktop) — works with existing `TableDisplayMenu`. | M | ✅ |

### E — Detail pages & forms

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R18** | **Partners editor responsive grids** | Collapse `grid-cols-12` blocks to `grid-cols-1 md:grid-cols-6 lg:grid-cols-12` (flows, SLA, contacts, ack overrides). | L | ✅ |
| **R19** | **Transaction detail overflow** | Wrap line-items `<table>` in `overflow-x-auto`; stack header dl to single column on `xs`. | S | ✅ |
| **R20** | **Lifecycle timeline narrow mode** | Stack set badge / metadata above card body below `sm`; keep vertical rail. | M | ✅ |
| **R21** | **Duplicate compare stack** | `DuplicateComparePanel` panels `flex-col md:flex-row` so compare works on phone-width windows. | S | ✅ |
| **R22** | **Modal / dialog mobile sizing** | Modals: `w-[calc(100vw-2rem)] sm:max-w-lg`, `max-h-[90dvh] overflow-y-auto` for keyboard-safe mobile. | M | ✅ |

### F — Dashboard & dense pages

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R23** | **Dashboard grid audit** | Verify stat cards `md:grid-cols-2 xl:grid-cols-4` with `min-w-0` on children; fix any grid blowout on resize. | S | ✅ |
| **R24** | **Documents view tabs** | Stack parsed/raw tabs under title on narrow widths (uses responsive `PageHeader` + tab wrap). | S | ✅ |
| **R25** | **Filter toolbar pattern** | Shared `FilterToolbar` component: primary filters inline, rest in “Filters” popover on `md` and below (Lifecycles pattern reused on Transactions/Ingestions/Alerts). | M | ✅ |

### G — Desktop app (Electron)

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R26** | **Minimum window size** | `minWidth: 960`, `minHeight: 600` on `BrowserWindow` — matches smallest supported layout breakpoint; show friendly message if user forces smaller (OS-dependent). | S | ✅ |
| **R27** | **Remember window bounds** | Persist size/position (and maximized state) to disk on close; restore on launch (`electron-store` or existing prefs file). | M | ✅ |
| **R28** | **HiDPI / zoom sanity** | Audit fixed `px` widths; prefer `rem` / `%` / `min()` so 125%/150% Windows scaling doesn’t clip header controls. | M | ✅ |

### H — Accessibility & polish

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R29** | **Skip to main** | Visually hidden “Skip to content” link targeting `<main id="main-content">` for keyboard users. | S | ✅ |
| **R30** | **Touch target pass** | Ensure 44×44px minimum on mobile nav, bell, row actions (extends U5 AC1 where hover-only actions remain). | M | ✅ |
| **R31** | **Safe area insets** | `padding-bottom: env(safe-area-inset-bottom)` on fixed toasts / sticky save bars for mobile browsers. | S | ✅ |
| **R32** | **Reduced motion** | Respect `prefers-reduced-motion` for Command Palette / drawer animations. | S | ✅ |

### I — Large screens & optional IA

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R33** | **Wider data column on 2xl** | At `2xl+`, optional second column on lifecycle detail (timeline + side panel metadata) — uses extra width without changing default laptop layout. | L | ✅ |
| **R34** | **Persistent sidebar nav (2xl+)** | Left sidebar instead of top nav on very wide screens — more vertical space for tables; **larger IA change**. | L | ✅ |
| **R35** | **Container queries** | `@container` on dashboard cards and filter cards so nested layouts respond to **panel** width, not only viewport. | M | ✅ |

### J — Testing & verification

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R36** | **Playwright viewport matrix** | Parity snapshots at **375**, **768**, **1280**, **1920** widths for Layout + one table page + one detail page. | M | ✅ |
| **R37** | **Resize manual checklist** | Add to `docs/LOCAL_DEV.md`: resize browser/desktop window through breakpoints; verify header, tables, partner editor. | S | ✅ |

---

## Recommendation catalog — round 2 (approved)

Additional fixes from code review — owner approved 2026-06-30.

### K — Layout bugfixes & header polish

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R38** | **Search box layout fix** | Remove duplicate `ml-auto` on `SearchBox` (parent `auth-controls` already pushes right); add `min-w-0` on flex parents so `w-64` search doesn’t force overflow before header wrap kicks in. *Not* icon-expand (R6 declined). | S | ✅ |
| **R39** | **Shorter search placeholder on narrow** | Swap placeholder text below `md` (e.g. “Search PO / ISA…”) so the fixed field doesn’t feel cramped. | S | ✅ |
| **R40** | **`min-w-0` on header flex children** | Apply `min-w-0` to Clerk switcher, auth-controls, and brand row so flex children can shrink instead of blowing out the header. | S | ✅ |

### L — Lists, pagination & data display

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R41** | **Responsive Pagination** | Stack page count + prev/next vertically on `xs`; keep horizontal bar on `sm+`. | S | ✅ |
| **R42** | **Sticky pagination on mobile cards** | Pin pagination to bottom of viewport (or card list footer) on long mobile card lists so users don’t scroll to paginate. | M | ✅ |
| **R43** | **Compact dates on narrow** | Use short date/time format in mobile cards and compact table density (e.g. `Jun 3` vs full locale string). | S | ✅ |
| **R44** | **Truncation + native `title` on dense cells** | Consistent `truncate` + `title` tooltip on partner names, PO numbers, and error messages in tables/cards. | S | ✅ |
| **R45** | **Disable sticky `thead` in card mode** | When mobile cards render, skip sticky header CSS entirely — avoids useless sticky offset work on non-table views. | S | ✅ |

### M — Page-specific responsive gaps

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R46** | **RawParsedView stack default** | Below `md`, default to stacked parsed-above-raw (not side-by-side); toggle still available. | S | ✅ |
| **R47** | **Settings & Help form columns** | Multi-field rows in Settings / Help glossary → single column below `md`. | S | ✅ |
| **R48** | **Audit log mobile detail** | Expandable audit rows: full-width accordion body, monospace JSON wraps with `break-all` on narrow screens. | M | ✅ |
| **R49** | **Alerts filter bar collapse** | Move partner/status filters into popover below `md` (same pattern as R25). | S | ✅ |
| **R50** | **Search results layout** | Clear section headings; stack transaction vs raw-file result blocks with spacing; avoid side-by-side tables. | S | ✅ |
| **R51** | **Metrics page stat grid** | Single column stat cards below `sm`; table below cards with same card/table rules as R13–R14. | S | ✅ |
| **R52** | **Channels card long errors** | `break-words` on channel error text; link row doesn’t clip on narrow cards. | S | ✅ |

### N — Overlays & global UI

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R53** | **Command palette full-width mobile** | `w-[calc(100vw-2rem)]` below `sm` instead of fixed `max-w-xl`. | S | ✅ |
| **R54** | **Toast position on mobile** | `left-4 right-4 sm:left-auto sm:right-4` so toasts aren’t clipped on narrow viewports. | S | ✅ |
| **R55** | **Desktop drop-folder banner** | Multi-line wrap + reduced padding on narrow windows (`Layout` ingest banner). | S | ✅ |
| **R56** | **Popover / dropdown max-height** | `max-h-[min(24rem,70dvh)] overflow-y-auto` on long menus (More nav, alert peek, filters). | S | ✅ |

### O — Interaction & visual polish

| ID | Recommendation | What it would do | Effort | Decision |
|----|----------------|------------------|--------|----------|
| **R57** | **Keyboard shortcuts overlay** | `?` opens a modal listing Cmd-K, `/` focus search, `Esc` close — improves discoverability on desktop. | M | ✅ |
| **R58** | **Touch-friendly primary buttons** | Slightly taller `btn-primary` padding below `md` on main CTAs (ingest, save partner, bulk ack). | S | ✅ |
| **R59** | **Reduce layout shift on load** | Skeleton dimensions tuned to match final card/table row heights (CLS polish). | M | ✅ |
| **R60** | **StatusPill overflow** | `max-w-full truncate` or wrap for long custom status labels in tables/cards. | S | ✅ |

---

## Implementation phases

Phases include **✅ OK** round-1 items only. Round-2 items slot into the matching phase once approved.

| Phase | Theme | IDs | Status |
|-------|--------|-----|--------|
| **UR0** | Tokens + shell | R1, R2, R3, R9 | ✅ Shipped |
| **UR1** | Header + nav | R5, R7, R8, R10, R12, R38–R40 | ✅ Shipped |
| **UR2** | Tables | R13–R17, R41–R45 | ✅ Shipped |
| **UR3** | Forms & detail | R18–R25, R46–R52 | ✅ Shipped |
| **UR4** | Desktop + a11y | R26–R32, R53–R56, R58 | ✅ Shipped |
| **UR5** | Large / ultra-wide | R4, R33–R35 | ✅ Shipped |
| **UR6** | Verification | R36, R37 | ✅ Shipped |
| **UR7** | Polish bundle | R57, R59, R60 + any stragglers | ✅ Shipped |

**UR1 note:** Search remains a always-visible `w-64` input per owner preference. Header wrap (R5) + progressive collapse (R7) handle crowding; optional R38–R40 if approved.

---

## Decision log

| Date | ID(s) | Verdict | Notes |
|------|-------|---------|-------|
| 2026-06-30 | R1–R5, R7–R37 | ✅ OK | Owner approved full responsiveness pass except search icon-expand |
| 2026-06-30 | R6 | ⛔ Declined | Keep search field always visible; no expand-on-click pattern |
| 2026-06-30 | R38–R60 | ✅ OK | Round 2 — all approved for UR1–UR7 |
| 2026-06-30 | UR0 | ✅ Shipped | R1, R2, R3, R9 — layout tokens, fluid shell, header height sync |
| 2026-06-30 | UR1 | ✅ Shipped | R5, R7, R8, R10, R12, R38–R40 — header wrap, drawer nav, PageHeader, breadcrumbs |
| 2026-06-30 | UR2 | ✅ Shipped | R13–R17, R41–R45 — lg card breakpoint, mobile cards all lists, scroll affordance, pagination |
| 2026-06-30 | UR3 | ✅ Shipped | R18–R25, R46–R52 — partner grids, detail pages, FilterToolbar, modal mobile sizing |
| 2026-06-30 | UR4 | ✅ Shipped | R26–R32, R53–R56, R58 — window bounds, skip link, touch targets, overlays, reduced motion |
| 2026-06-30 | UR5 | ✅ Shipped | R4, R33–R35 — FullBleed, 2xl sidebar, lifecycle summary panel, container queries |
| 2026-06-30 | UR6 | ✅ Shipped | R36, R37 — Playwright viewport matrix + LOCAL_DEV resize checklist |
| 2026-06-30 | UR7 | ✅ Shipped | R57, R59, R60 — keyboard shortcuts overlay, CLS skeletons, StatusPill truncate |

---

## Out of scope (unless you explicitly ask)

- Separate mobile-native app or PWA install flow  
- Rearranging information architecture (nav destinations) — see declined **ST2** in UI Build Plan  
- Backend/API changes for responsiveness  
- Paid hosting or deploy changes  
- Virtualized/infinite-scroll tables (performance at 10k+ rows) — flag if ingest volume demands it  

---

## Related files (implementation touchpoints)

| Area | Primary files |
|------|----------------|
| Shell | `apps/web/src/components/Layout.tsx`, `apps/web/src/index.css` |
| Page chrome | `apps/web/src/components/ui/PageHeader.tsx`, `Breadcrumbs.tsx` |
| Tables | `DataTable.tsx`, `MobileTableCards.tsx`, `useMediaQuery.ts` |
| Partner forms | `apps/web/src/pages/PartnersConfigPage.tsx` |
| Desktop | `apps/desktop/src/main.ts` |
| Tests | `apps/web/e2e/`, vitest page tests |
