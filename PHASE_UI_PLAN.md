# UI Overhaul — Phase plan (Path A · Sprint A3)

> **Roadmap status:** Gates and sequencing are in **`BUILD_PLAN.md`** § UI overhaul. This file holds gate options and sprint deliverables.

**Status:** Draft — decision gates open  
**Scope rule (anti-drift):** Every change must improve **monitoring, troubleshooting, or alerting** readability — especially lifecycle stitching and alerts. No theming for itsing's sake.

**Prerequisite:** Sprint A2 complete (staging operational) is recommended so UI work can be validated against real data.

---

## Decision gates (resolve before coding)

Reply with your choices (or accept defaults) to unblock Sprint A3.

### Gate A — Accent / brand color

| Option | Description |
|--------|-------------|
| **A1 (default)** | Keep current indigo/slate (`#818cf8` accent) — matches desktop update splash |
| **A2** | Teal accent for "ops dashboard" feel (`#14b8a6`) |
| **A3** | Custom — provide hex |

**Recommendation:** **A1** — zero migration risk; focus effort on layout/data density.

### Gate B — Dark mode

| Option | Description |
|--------|-------------|
| **B1 (default)** | Light mode only for v1 overhaul |
| **B2** | Light + dark toggle (system preference) |
| **B3** | Dark default for ops users |

**Recommendation:** **B1** — ship readability wins first; dark mode is a second pass.

### Gate C — Component library

| Option | Description |
|--------|-------------|
| **C1 (default)** | Continue Tailwind + existing patterns; add shadcn/ui primitives only where they replace hand-rolled tables/dialogs |
| **C2** | Full shadcn/ui adoption across all pages |
| **C3** | No new components — CSS/layout only |

**Recommendation:** **C1** — shadcn for data tables, dialogs, and toasts on Lifecycle + Alerts pages only.

---

## In-scope pages (priority order)

1. **Lifecycle view** — PO timeline: status chips, gap callouts, ack errors inline, chronological scan in &lt;10s  
2. **Alerts list + detail** — SLA context, partner name, ack link, snooze/ack actions obvious  
3. **Transaction list** — denser filters, saved URL state (already exists — polish only)  
4. **Partners config** — read-only clarity for SLA windows (no new config surface)

## Out of scope

- Marketing / landing site (Phase 11)  
- Desktop Electron chrome  
- New features not in BUILD_PLAN Phases 0–10  

---

## Sprint A3.1 — Lifecycle readability

**Deliverables:**

- Timeline component: each doc type (850/855/856/810/997) with consistent status color + timestamp  
- "Missing expected document" gaps styled as warnings, not empty errors  
- 997 rejection summary expandable inline (AK3/AK4 plain English from ack-decoder)  
- Playwright snapshot update for `lifecycle-view.spec.ts`

**Exit criteria:** Keagan can find a PO's full chain and spot a missing 856 in under 30 seconds on pilot data.

## Sprint A3.2 — Alerts readability

**Deliverables:**

- Alert row: partner, type, age vs SLA, deep link to lifecycle or transaction  
- Bulk ack/snooze patterns if ops uses them daily (only if pilot confirms need)  
- Empty state when no alerts  

**Exit criteria:** Pilot user can triage top 5 alerts without opening more than 2 extra clicks each.

---

## Technical notes

- Stack: React + Vite + Tailwind (`apps/web`)  
- Tests: existing Vitest + Playwright parity (`apps/web/test`, `apps/desktop/test/parity`)  
- No API schema changes unless a display field is missing — prefer computed UI from existing endpoints  

---

## How to unblock

Post your gate choices, e.g.:

```
Gate A: A1
Gate B: B1
Gate C: C1
```

Defaults above apply if you say "use defaults."
