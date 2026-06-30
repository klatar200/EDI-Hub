# EDI Data Hub — Build Plan

**Owner:** Keagan  
**Last updated:** 2026-06-30  
**Purpose:** **Forward-looking work only** — active track, deferred go-live sprints, future/optional backlog, open checklists.

> **Completed work** → [`docs/SHIPPED.md`](docs/SHIPPED.md) · **Product context** → [`docs/WIKI.md`](docs/WIKI.md) · **AI builder rules** → [`AGENTS.md`](AGENTS.md) · **Security sign-off** → [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md) · **Local how-to** → [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md)

### Document hierarchy

| Doc | Use when |
|-----|----------|
| **`BUILD_PLAN.md`** (this file) | What to build / verify **next** |
| [`docs/SHIPPED.md`](docs/SHIPPED.md) | What is **already done** |
| [`docs/WIKI.md`](docs/WIKI.md) | **Why** — principles, stack, doc map |
| [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md) | Pre-launch security sign-off |
| [`AGENTS.md`](AGENTS.md) | Agent git/CI/cost/tenancy rules |

---

## Table of contents

1. [Snapshot](#1-snapshot)
2. [Active track — UI responsiveness (UR0–UR7)](#2-active-track--ui-responsiveness-ur0ur7)
3. [Local validation ($0)](#3-local-validation-0)
4. [Architecture constraints (do not reopen)](#4-architecture-constraints-do-not-reopen)
5. [Deploy track — go-live gate (deferred)](#5-deploy-track--go-live-gate-deferred)
6. [Future & optional features](#6-future--optional-features)
7. [Phase 11 & 12 — go to market](#7-phase-11--12--go-to-market)
8. [Source map](#8-source-map)

---

## 1. Snapshot

| Area | Status |
|------|--------|
| Product (phases 0–10, desktop, PS/PB sprints) | ✅ Complete — [`docs/SHIPPED.md`](docs/SHIPPED.md) |
| UI Build Plan (U0–U5) | ✅ Complete — [`docs/SHIPPED.md` §4.1](docs/SHIPPED.md#41-ui-build-plan-refresh--u0u5) · archive [`docs/UI_BUILD_PLAN.md`](docs/UI_BUILD_PLAN.md) |
| Security remediation SEC-1–5 | ✅ — [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) |
| **Active** | **UI responsiveness UR0–UR7** — [§2](#2-active-track--ui-responsiveness-ur0ur7) · catalog [`docs/UI_RESPONSIVE_PLAN.md`](docs/UI_RESPONSIVE_PLAN.md) |
| Local validation | [§3](#3-local-validation-0) — parallel exit criteria |
| **Deferred** | AWS staging, M5 ops proof, Phase 11–12 — [§5](#5-deploy-track--go-live-gate-deferred) |
| Tests / CI | `npm run test:ci` green on `main` |

**M5 in code ≠ M5 in production.** Restore drill, k6 baseline, runbook cold-read run at **go-live**, not during local-only dev.

---

## 2. Active track — UI responsiveness (UR0–UR7)

**Goal:** Fluid shell, adaptive nav, responsive tables/forms across web + desktop (same React bundle).

**Full catalog & decisions:** [`docs/UI_RESPONSIVE_PLAN.md`](docs/UI_RESPONSIVE_PLAN.md) — **R1–R60 approved** except **R6** declined.

| Sprint | Focus | Key IDs | Status |
|--------|--------|---------|--------|
| **UR0** | Layout tokens + fluid shell | R1, R2, R3, R9 | ✅ |
| **UR1** | Header wrap, drawer nav, PageHeader | R5, R7, R8, R10, R12, R38–R40 | ✅ |
| **UR2** | Tables + pagination | R13–R17, R41–R45 | ✅ |
| **UR3** | Forms, detail pages, filters | R18–R25, R46–R52 | ✅ |
| **UR4** | Electron + overlays + a11y | R26–R32, R53–R56, R58 | ✅ |
| **UR5** | Ultra-wide layouts | R4, R33–R35 | ✅ |
| **UR6** | Playwright viewports + checklist | R36, R37 | ✅ |
| **UR7** | Polish | R57, R59, R60 | ✅ |

**Exit (responsiveness track):** UR0–UR7 ✅ · `npm run test:ci` green · parity snapshots at 375 / 768 / 1280 / 1920 (R36).

---

## 3. Local validation ($0)

**Goal:** Full hub on your machine — no AWS, no `terraform apply`.

**Guide:** [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md)

### Exit criteria

- [x] `npm run test:ci` green
- [x] UI Build Plan U0–U5 shipped (desktop **v0.0.37-alpha**)
- [ ] `npm run validate:local` green (Docker Postgres + MinIO — ingest, lifecycle, detection)
- [ ] Sign in (Clerk or dev-fallback) and see lifecycles UI
- [ ] Upload or SFTP-drop test 850 → appears in lifecycle list
- [ ] Alerts/detection runnable locally

### Out of scope until go-live

AWS, Terraform, Route 53, Clerk Hobby billing, k6 on staging, RDS restore drills — [§5](#5-deploy-track--go-live-gate-deferred).

---

## 4. Architecture constraints (do not reopen)

Accepted decisions — full rationale in ADRs; implementation in [`docs/SHIPPED.md` §5](docs/SHIPPED.md#5-remediation--adrs-accepted).

| Topic | Decision | ADR |
|-------|----------|-----|
| Ingestion queue | Sync parse + startup reconcile; no BullMQ/Redis for v1 | [0001](docs/adr/0001-w3.1-synchronous-ingestion-with-reconcile.md) |
| Web deploy | Same-origin default (`WEB_STATIC_DIR`); CORS only if split hosts | [0002](docs/adr/0002-w3.2-same-origin-default-cors-escape-hatch.md) |

**Revisit BullMQ** when ingest volume or CPU isolation requires a dedicated parse-worker tier (criteria in ADR 0001).

---

## 5. Deploy track — go-live gate (deferred)

> 🔒 **NOT ACTIVE.** No paid cloud until owner opts in. ~**$40–60+/mo** minimum staging. Walkthrough: [`infra/WINDOWS.md`](infra/WINDOWS.md)

### Sprint A1 — Staging environment

**Goal:** HTTPS API + RDS + S3 + Secrets Manager + Clerk staging.

**Exit:** `curl https://<staging>/health` → 200; Clerk login; one test ingestion in S3 + Postgres.

**Checklist:**

- [ ] AWS account, IAM, Route 53, `aws configure`
- [ ] `terraform apply` per [`infra/README.md`](infra/README.md) and [`infra/WINDOWS.md`](infra/WINDOWS.md)
- [ ] Secrets: `DATABASE_URL`, `CLERK_*`, optional `GLOBAL_SLACK_WEBHOOK`
- [ ] Clerk staging app + webhook — [`CLERK_SETUP.md`](CLERK_SETUP.md)
- [ ] Bake `apps/web/dist` into API image; `WEB_STATIC_DIR` (ADR 0002)
- [ ] Smoke: `infra/README.md` § security posture

### Sprint A2 — Operational proof (M5)

Complete before tag `m5-production-ready`:

- [ ] Restore drill → `ops/RESTORE_LOG.md`
- [ ] k6 baseline (2 runs within 10%) → `ops/load/baseline.md`
- [ ] [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md) sign-off
- [ ] Runbook cold-read → `ops/RUNBOOKS.md`
- [ ] Rate limit 429 + `rate.exceeded` audit row in staging
- [ ] Retention task daily; observability per Phase 10 exit below

**Phase 10 exit (M5 — production-ready):**

- [ ] `/internal/metrics` scrapable; CloudWatch tenant-filtered logs
- [ ] Backups proven — entry in `ops/RESTORE_LOG.md`
- [ ] Daily `retention.run` audit row per tenant
- [ ] Runbooks usable after cold-read

**Infrastructure apply detail:** networking/storage targets, CloudWatch, backup container — see [`ops/PRE_PRODUCTION_TODO.md`](ops/PRE_PRODUCTION_TODO.md) (redirect) or historical checklist in git history; operator steps in `infra/README.md`.

---

## 6. Future & optional features

Not on the active roadmap. Each item should serve monitoring, troubleshooting, alerting, or stability — or Phase 11+.

**Cost policy:** [`AGENTS.md`](AGENTS.md) §2 — no AWS spend during local dev.

### Architecture & infrastructure (paid / go-live)

| Feature | Notes |
|---------|-------|
| BullMQ + Redis | When sub-minute cadence justifies it |
| WAF on ALB | If abuse appears post-launch |
| Multi-region failover | Enterprise tier |
| APM / tracing | When multi-service |
| Per-tenant KMS (BYOK) | Phase 11+ |
| SOC 2 / pen test | Regulated buyer |

### Monitoring & alerting

PagerDuty/Opsgenie, escalation chains, calendar-aware SLAs/quiet hours, ML anomaly detection, 999 IK deep parse, due-date **sort** on lifecycle list.

### Parser & data

Tier C transaction sets; line-level multi-PO on 810.

### Open polish

| ID | Item | Status |
|----|------|--------|
| **W4.2** | Authenticated raw-file viewing (fetch+blob under Clerk) | Open |
| **OPTIONAL-D1** | Desktop boot log noise | Optional |
| **OPTIONAL-D2** | Desktop update sequence polish | Optional |

### Commercial (Phase 11+)

Stripe self-serve, marketing site, per-tenant quotas, Linux desktop (AppImage).

---

## 7. Phase 11 & 12 — go to market

🔒 Deferred until [§5](#5-deploy-track--go-live-gate-deferred) staging is live.

**Phase 11 — Commercialization:** Tiers, onboarding, customer docs, marketing, ToS/Privacy/DPA. Blockers: Gate 4 (Stripe vs direct sales), Q7, Q11.

**Phase 12 — M6:** 1–2 design partners → first paid contract.

---

## 8. Source map

| Former location | Now |
|-----------------|-----|
| Completed sprints, F1–F62, phases | [`docs/SHIPPED.md`](docs/SHIPPED.md) |
| North Star, principles, doc guide | [`docs/WIKI.md`](docs/WIKI.md) |
| Clerk setup steps | [`CLERK_SETUP.md`](CLERK_SETUP.md) |
| [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md) | [§6](#6-future--optional-features) |
| [`docs/FEATURE_STATUS.md`](docs/FEATURE_STATUS.md) | [`docs/SHIPPED.md` §6](docs/SHIPPED.md#6-feature-matrix-f1f62) |
| [`PRODUCT_BACKLOG.md`](PRODUCT_BACKLOG.md) | [`docs/SHIPPED.md` §7](docs/SHIPPED.md#7-product-backlog-history) |
| UI Build Plan (complete) | [`docs/SHIPPED.md` §4.1](docs/SHIPPED.md#41-ui-build-plan-refresh--u0u5) · [`docs/UI_BUILD_PLAN.md`](docs/UI_BUILD_PLAN.md) (archive) |
| UI responsiveness (UR0–UR7) | [`docs/UI_RESPONSIVE_PLAN.md`](docs/UI_RESPONSIVE_PLAN.md) |
| Security sign-off | [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md) |

**Do not add completed work to this file** — append to `docs/SHIPPED.md` when a sprint ships.
