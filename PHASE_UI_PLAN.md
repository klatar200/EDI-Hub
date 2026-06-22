# UI Overhaul — Phase Plan (v1 Working Draft)

**Owner:** Keagan
**Status:** Draft pending answers to the Decision Gates below
**Build agent:** Claude
**Stack:** React 18 + Vite + Tailwind CSS v4 (already installed)

---

## 1. The Objective

Take the EDI Hub from "functional but austere" to **enjoyable, sleek,
modern, and instantly readable for an EDI operator at 9 AM with coffee
in hand**. The product is data-dense by nature — the design must make
that data legible and scannable, NOT cram it with chrome.

**North Star UX**: an operator should be able to glance at the lifecycle
view for a known PO and tell at one second whether the order is healthy,
in flight, or stuck. Everything else — navigation, polish, dark mode —
exists to serve that moment.

**Anti-drift rule:** before adding a UI flourish, ask "does it make the
data more readable or the next action more obvious?" If no, it waits.

---

## 2. Design Pillars

1. **Quiet data first, chrome second.** Tables and timelines fill the
   canvas; headers, filters, and surrounding UI stay restrained.
2. **One accent color, used sparingly.** Status colors (success / warn /
   error) are reserved for genuine status signals. Don't gradient up an
   "ok" row.
3. **Vertical rhythm.** Consistent spacing scale across every page so
   nothing feels homemade.
4. **Density without claustrophobia.** EDI rows have a lot of fields;
   default to comfortable density, offer compact toggle later if needed.
5. **Motion is functional, not decorative.** Transitions confirm state
   changes (loading → loaded, opening a drawer); no parallax or
   decorative animation.

---

## 3. Decision Gates (need your answers before Sprint 1)

| Gate | Default I'd pick | Override? |
|---|---|---|
| **A — Brand / accent color** | Indigo (a calm professional blue-violet). Sets the tone for buttons, focus rings, active nav. | Tell me if you want a different hue (teal, emerald, slate, custom hex). |
| **B — Dark mode** | Ship light first; add dark mode in the last sprint of this phase. Both work via Tailwind's `dark:` variant. | Skip dark mode entirely / require it from Sprint 1. |
| **C — Component library** | Hand-rolled Tailwind primitives (kept in `apps/web/src/components/ui/`) — minimal dep footprint, full control. shadcn/ui is overkill for the surface we have. | Use shadcn/ui (more components out of the box, but a heavier abstraction). |
| **D — Typography** | Inter (system fallback) for UI, JetBrains Mono for raw EDI / IDs. Both via Google Fonts. | Different font choice. |
| **E — Logo / wordmark** | Wordmark only ("EDI Hub") in the brand color — no logo image yet. | Provide a logo SVG / let me design one. |
| **F — Reference apps** | I'll aim for the visual register of Linear / Vercel / Railway dashboards — dense, calm, opinionated. | Point at a different reference if you have one. |

---

## 4. What changes per sprint

> Effort: ~3–6 sprints, sized for 15–25 hrs/week solo. Each sprint ends in
> a demoable improvement. No phase exits without a real before/after.

### Sprint 1 — Design tokens + Tailwind config + layout shell
**Goal:** A single source of truth for colors / spacing / type, and a
refreshed layout shell that makes the existing pages look ~80% better
with zero changes to individual pages yet.

**Tasks:**
- Define color tokens (Tailwind `@theme` directive in v4): brand,
  neutral scale, status (success/warn/error/info), surfaces (bg, card,
  border).
- Type scale tokens: display, h1–h3, body, small, mono.
- Spacing + radius + shadow scale (likely mirrors Tailwind defaults but
  documents what we use).
- Refresh `Layout.tsx`: cleaner top nav, app logo wordmark, breadcrumb
  area, OrganizationSwitcher + UserButton styled to match.
- Wrap nav items in a coherent "section" pattern.

**Demo:** open every page — they look noticeably more polished even
though only the shell changed.

### Sprint 2 — Data tables (Transactions, Ingestions, Alerts list)
**Goal:** Tables are the heart of the app. Sticky headers, zebra rows,
status pills, partner avatars, hover affordances, empty states.

**Tasks:**
- Reusable `<DataTable>` primitive (header, row, cell, sort indicator).
- Status pill component (success / warn / error / neutral) — reused
  everywhere status is shown.
- Empty-state illustrations / copy per table.
- Filter chip pattern (active filters visible as removable chips above
  the table).
- Pagination footer.

### Sprint 3 — Lifecycle viewer (the North Star)
**Goal:** The lifecycle page becomes the page you'd put on a marketing
screenshot. Real timeline visualization, status chips per node, gap
markers, rejection details inline.

**Tasks:**
- Vertical timeline (timestamp + set badge + partner + status).
- Gap markers (e.g., "Expected 855, not received within SLA — 14 h overdue").
- Rejection panel inline (expands with AK error details).
- Print-friendly view (operators sometimes screenshot or PDF these for
  vendors).

### Sprint 4 — Forms, modals, drawers, empty/loading states
**Goal:** Every interaction feels polished. No more bare browser
controls; no more spinner emojis.

**Tasks:**
- Form primitives (`<Input>`, `<Select>`, `<Textarea>`, `<Switch>`,
  `<RadioGroup>`).
- Modal + side-drawer primitives (Partner editor, Alert details).
- Loading skeletons per page (matches the eventual layout, no spinners).
- Empty states with helpful next-action copy.
- Toast notifications for write-path feedback (replaces the inline
  `alert()`-style messages, if any).

### Sprint 5 — Alerts page + Metrics page + Partners-config polish
**Goal:** The two operational pages an admin lives in daily. Severity
visualization, time-of-arrival sparklines, rejection-rate gauges.

**Tasks:**
- Alert card layout (severity colored bar on the left, body, source-ref
  link, ack / snooze buttons).
- Rejection-rate sparkline per partner on the Metrics page.
- Partners-config: editor split-pane (list left, edit right).
- Connectivity badge polish (the AS2/SFTP/VAN chips Phase 8 added).

### Sprint 6 — Dark mode + accessibility + motion polish
**Goal:** Dark mode looks designed, not auto-inverted. Keyboard nav
works everywhere. Motion is consistent.

**Tasks:**
- Dark variant for every token (and every component using one).
- Theme toggle in header (system / light / dark).
- ARIA review on tables, modals, navigation.
- Focus ring consistency (the brand-color focus ring across every
  interactive element).
- Transition tokens (open/close timings, easing) standardized.

---

## 5. Out of scope (for now)

- Wholesale dashboard redesign with KPI cards. Phase 11 territory.
- Mobile / responsive past breakpoints. Operators are at desks.
- Internationalization. English-only.
- Custom illustrations beyond minimal empty-state SVGs.
- Animations beyond functional transitions.
- Splash screens / marketing pages — that's Phase 11.

---

## 6. Open Questions

1. Brand color — go with indigo, or do you have a hue in mind?
2. Dark mode — ship it from Sprint 1 (parallel) or end (Sprint 6 only)?
3. Logo — wordmark for now is fine?
4. Anything you want from a reference (Linear / Vercel / Railway / etc.)?

Answer 1–4 and we kick off Sprint 1.
