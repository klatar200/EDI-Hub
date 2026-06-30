# ADR 0003: UI foundations — landing pages, component layer, status tones, nav target

**Status:** Accepted (Phase U0)
**Date:** 2026-06-30
**Deciders:** Keagan (product/engineering)
**Build plan item:** [`docs/UI_BUILD_PLAN.md`](../UI_BUILD_PLAN.md) Phase U0; resolves Gates UI-1, UI-2 (UI-3 recommended)

---

## Context

A UI/UX review produced 22 recommendations (see `UI_BUILD_PLAN.md`). Three are upstream decisions that every later phase depends on, so they are fixed here before building.

---

## Decision UI-1 — Monitoring landing (✅ implemented)

Both landing surfaces stay. The **root path `/` resolves to the user's chosen landing**, selectable per-user in Settings, defaulting to **Monitoring (the Dashboard)**.

- Stored on `UserPreferences.defaultLanding: 'dashboard' | 'lifecycles'` (default `'dashboard'`).
- `/dashboard` and `/lifecycles` are explicit routes; `/` redirects based on the preference.
- Any user sets their own (it's a personal preference, not admin-gated).

**Status:** shipped this phase (`AppRoutes.tsx`, `routes/preferences.ts`, `SettingsPage.tsx`).

---

## Decision UI-2 — Component layer: adopt shadcn/Radix, incrementally

**Decision:** standardize interactive primitives on **Radix (shadcn/ui patterns)**, wrapped under `apps/web/src/components/ui` and themed with the existing CSS-var tokens.

**Why (fact-based):**
- The plan's hardest, most accessibility-sensitive pieces — command palette, dropdown menus, tabs, tooltips, popover, dialog — are exactly what Radix provides correctly (focus trap, keyboard nav, ARIA). Hand-rolling these is lower quality and more code.
- AC1 (accessibility) is an explicit plan goal; Radix is accessibility-first.
- Radix is unstyled and composes with Tailwind + the CSS-var token system — no theming conflict.
- The current nav menus use native `<details>` (no focus management, awkward dismissal); Radix `DropdownMenu`/`Popover` replace them cleanly.

**Scope discipline:** pull primitives in **only when a phase first consumes one** (not a big-bang rewrite), to control bundle size. Wrappers keep the existing visual language.

**Dependencies to install at the start of U1** (web workspace):

| Package | Used by |
|---------|---------|
| `@radix-ui/react-popover` | T1 Filters popover (U1) |
| `@radix-ui/react-dropdown-menu` | N1 nav overflow (U1) |
| `@radix-ui/react-tabs` | FO1 partner editor (U2) |
| `@radix-ui/react-tooltip` | O1 jargon tooltips (U5) |
| `@radix-ui/react-dialog` | dialogs/modals (replaces bespoke `Modal`) |
| `cmdk` | N4 command palette (U4) |
| `clsx` + `tailwind-merge` | className composition helper (`cn`) |

> Install is deferred out of the current sandbox on purpose (it has a hand-repaired `node_modules`); the wrapper components are built and verified against the installed deps at U1 start.

---

## Decision UI-3 — Transactions vs Ingestions (recommended; confirm before U3)

**Recommendation:** **keep two pages but relabel and cross-link** rather than merging immediately.

- They are genuinely different granularities: **Ingestions** = raw transmission/file level (`raw_files`: dedup, parse status, retry), **Transactions** = decoded transaction level (850/810/…). A single grid would fight two column sets and two action sets.
- Cheaper, clearer win: relabel to reduce jargon (e.g. "Ingestions" → *Files received*, "Transactions" → *Documents*), and add a link from a file to the transactions it produced.
- Revisit a unified "Documents" explorer with a raw/parsed toggle only if pilot users actually conflate them.

**Status:** open — confirm at U3.

---

## Decision — Navigation target (N1)

Reduce the inline primary nav from 12 links to a small daily set, with the rest behind a labeled menu:

- **Primary (inline):** Lifecycles · Monitoring (Dashboard) · Alerts
- **Explore (group):** Documents (Transactions + Ingestions) · Metrics
- **Configure (dropdown):** Partners · Channels · Settings · Users · Audit · Help
- **Right rail:** global search · alert bell (ST3) · org switcher · user

This lands in U1 (N1) on the Radix `DropdownMenu`.

---

## Decision — Status-tone policy (S1, ✅ implemented)

`apps/web/src/components/ui/status-tones.ts` is the **single source of truth** mapping domain status/severity to a `StatusPill` tone. Tone meanings are fixed:

| Tone | Meaning |
|------|---------|
| success (green) | healthy / complete / acknowledged / confirmed |
| error (red) | failure / rejected / critical / open problem |
| warn (amber) | needs attention / pending / overdue-soon / expected-missing |
| info (blue) | informational / in-progress / inbound / received |
| brand (indigo) | category accent (e.g. outbound) — not a health signal |
| neutral (grey) | inert / disabled / unknown / no signal |

New status surfaces add a mapper there and import it; no inline tone ternaries or per-file maps. Alerts is migrated as the reference; the remaining local maps (`LifecycleTimeline`, `OutboundStage`, `ChannelsPage`, `PartnersConfigPage`) migrate incrementally during U1–U2.

---

## Consequences

- U1 can proceed immediately on nav (N1) and the filter popover (T1) once the Radix deps are installed.
- A consistent tone vocabulary is now enforceable in review (point at this ADR + `status-tones.ts`).
- UI-3 remains the one open product call; it does not block U1/U2.
