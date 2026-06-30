# EDI Data Hub — wiki (product context)

**Purpose:** Stable **explanations and principles** — the “why” and “what is this product.” Not for sprint tracking (use [`BUILD_PLAN.md`](../BUILD_PLAN.md)) or shipped history (use [`docs/SHIPPED.md`](SHIPPED.md)).

**Audience:** Humans onboarding to the repo **and** AI builders needing product context without wading through checklists.

---

## North Star

**Transaction lifecycle stitching** — one PO number shows the 850, 855, 856, 810, and all 997s in chronological, status-aware order.

The hub is **passive observability**: it receives *copies* of EDI (upload, SFTP, AS2, folder-watch). It never sits in the live transmission path.

---

## Principles

| Principle | Meaning |
|-----------|---------|
| Raw file is sacred | Store verbatim before parse; parsing failures never lose the original |
| De-risk parsing early | Typed parsers + fixtures before UI polish |
| Every phase demoable | Ship something observable at each milestone |
| Local-first until go-live | Zero cloud spend during development ([`AGENTS.md`](../AGENTS.md) §2) |
| Anti-drift | New work must serve monitoring, troubleshooting, alerting, or stability ([`AGENTS.md`](../AGENTS.md) §1) |

---

## Tech stack

| Layer | Local ($0) | Production (deferred) |
|-------|------------|------------------------|
| Frontend | React + Vite + Tailwind + shadcn | Same (baked into API image or CDN) |
| API | Fastify + TypeScript | ECS Fargate |
| Database | Docker Postgres | RDS PostgreSQL |
| Object storage | MinIO | S3 |
| Auth | Clerk Free / dev-fallback | Clerk + Organizations |
| Jobs | Postgres `Job` table + cron | Same (BullMQ deferred — [ADR 0001](adr/0001-w3.1-synchronous-ingestion-with-reconcile.md)) |
| IaC | `docker compose` only | Terraform in `infra/` |

Monorepo layout → [`README.md`](../README.md#monorepo-layout).

---

## How documentation is organized (for AI builders)

Read **only what the task needs** — avoids context bloat and wrong edits.

| Question | Read first |
|----------|------------|
| What should I build next? | [`BUILD_PLAN.md`](../BUILD_PLAN.md) |
| Was feature X already built? | [`docs/SHIPPED.md`](SHIPPED.md) or [`README.md` § Features](../README.md#features) |
| Was the UI Build Plan (U0–U5) finished? | [`docs/SHIPPED.md` §4.1](SHIPPED.md#41-ui-build-plan-refresh--u0u5) |
| What are the coding / git / CI rules? | [`AGENTS.md`](../AGENTS.md) |
| How do I run locally? | [`docs/LOCAL_DEV.md`](LOCAL_DEV.md) |
| Security sign-off item? | [`SECURITY_CHECKLIST.md`](../SECURITY_CHECKLIST.md) |
| Security finding / remediation? | [`docs/SECURITY_AUDIT.md`](SECURITY_AUDIT.md) |
| Architecture decision (queue, CORS)? | [`docs/adr/`](adr/) |
| Clerk wiring? | [`CLERK_SETUP.md`](../CLERK_SETUP.md) |
| Product “why” and principles? | **This file** |

**Rule of thumb:** `BUILD_PLAN.md` = **future** (checkboxes, deferred sprints). `SHIPPED.md` = **past** (tables, sprint IDs). `WIKI.md` = **context** (prose). `AGENTS.md` = **constraints** for agents.

---

## Milestones (high level)

| Milestone | Meaning | Status |
|-----------|---------|--------|
| **M1** | Data Hub UI | ✅ |
| **M2** | Lifecycle stitching | ✅ |
| **M3** | Monitoring & alerting | ✅ |
| **M4** | Multi-tenant + sellable security | ✅ code |
| **M5** | Production-ready operations | ✅ code / ⏳ deploy proof at go-live |
| **M6** | First external customer | ⏳ Phase 11–12 |
| UI overhaul | U0–U5 refresh (nav, Documents, Cmd-K, a11y, mobile) | ✅ — [`SHIPPED.md` §4.1](SHIPPED.md#41-ui-build-plan-refresh--u0u5) |

Detail → [`docs/SHIPPED.md` §1](SHIPPED.md#1-phase--milestone-map).

---

## Explicitly out of scope (v1)

VAN/transmission, mapping editor, ERP connectors, chargeback workflows, sitting in the live EDI path.

Optional/deferred ideas → [`BUILD_PLAN.md` §5](../BUILD_PLAN.md#5-future--optional-features).
