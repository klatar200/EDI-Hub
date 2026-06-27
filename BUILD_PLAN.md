# EDI Data Hub — Build Plan & Roadmap

**Owner:** Keagan  
**Last updated:** 2026-06-25  
**Status:** Phases **0–10** and **desktop track** code-complete. **Production deploy** and **first external customer** not done.

> **Active planning lives here.** Shipped capabilities are listed in [`README.md`](README.md#features). Optional and deferred ideas are in [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md). Operational runbooks stay in `ops/RUNBOOKS.md`.

---

## Table of contents

1. [Current snapshot](#1-current-snapshot)
2. [North Star & principles](#2-north-star--principles)
3. [Roadmap — what's next](#3-roadmap--whats-next)
4. [Phase & milestone map](#4-phase--milestone-map)
5. [Tech stack](#5-tech-stack)
6. [Active product backlog](#6-active-product-backlog)
7. [UI overhaul (Sprint A3)](#7-ui-overhaul-sprint-a3)
8. [Open remediation & architecture decisions](#8-open-remediation--architecture-decisions)
9. [Deploy track — staging & M5 proof](#9-deploy-track--staging--m5-proof)
10. [Pre-production operator checklist](#10-pre-production-operator-checklist)
11. [Clerk setup](#11-clerk-setup)
12. [Security checklist (sign-off)](#12-security-checklist-sign-off)
13. [Phase 11 & 12 — go to market](#13-phase-11--12--go-to-market)
14. [Commands](#14-commands)

---

## 1. Current snapshot

| Area | Status |
|---|---|
| **SaaS phases 0–10** | ✅ Code-complete |
| **Desktop track (D1–D9)** | ✅ Code-complete |
| **Path A-core remediation** | ✅ W1.1, W1.2, W2.1–W2.3, W3.3, W3.4 done |
| **Tests** | **383** — 46 db · 46 parser · 228 api · 42 web · 21 desktop |
| **CI** | typecheck · lint (0 warnings) · `test:ci` green |
| **Production** | ⏳ Not deployed — [§10](#10-pre-production-operator-checklist) |
| **Next focus** | Architecture ADRs (W3.1/W3.2) → staging deploy |

**M5 in code ≠ M5 in production.** Operator drills (restore, k6 baseline, runbook cold-read) must pass before M5 is declared in a live environment.

---

## 2. North Star & principles

**North Star:** *Transaction lifecycle stitching* — one PO number shows 850, 855, 856, 810, and all 997s in chronological, status-aware order.

**Anti-drift rule:** New work must serve monitoring, troubleshooting, alerting, or stability.

**Principles:** De-risk parsing early · every phase demoable · raw file is sacred · passive observability (copies only, never live path).

---

## 3. Roadmap — what's next

| # | Workstream | Status |
|---|---|---|
| 1 | Path A-core remediation | ✅ Done |
| 2 | Manual import UI | ✅ Done (Ingestions upload panel) |
| 3 | Lifecycle duplicates UI | ✅ Done (instance labels + inline raw) |
| 4 | **UI overhaul** — Sprint A3 (A1/B2/C1) | ✅ Done → [§7](#7-ui-overhaul-sprint-a3) |
| 5 | Queue + CORS architecture ADRs | ⏳ **Next** → [§8](#8-open-remediation--architecture-decisions) |
| 6 | Staging deploy (Sprint A1) | ⏳ Needs AWS → [§9](#9-deploy-track--staging--m5-proof) |
| 7 | M5 operational proof (Sprint A2) | ⏳ → [§10 exit checklist](#phase-10-exit-checklist-m5--production-ready) |
| 8 | Phase 11 commercialization | ⏳ → [§13](#13-phase-11--12--go-to-market) |
| 9 | Phase 12 external pilot (M6) | ⏳ → [§13](#13-phase-11--12--go-to-market) |

Low-priority polish (W4.x, desktop OPTIONAL-D1/D2, deferred product ideas) → [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md).

---

## 4. Phase & milestone map

| Phase | Milestone | Status |
|---|---|---|
| 0–2 | — | ✅ Scaffolding, ingestion, parser |
| 3 | **M1** | ✅ Data Hub UI |
| 4 | **M2** | ✅ Lifecycle stitching |
| 5–6 | — | ✅ Ack intelligence, partner config |
| 7 | **M3** | ✅ Monitoring & alerting |
| 8 | — | ✅ Outbound + AS2 |
| 9 | **M4** | ✅ Multi-tenant, RBAC, audit, Clerk |
| 10 | **M5** *code* | ✅ Code / ⏳ deploy proof |
| Desktop | — | ✅ LAN server installer, auto-update |
| UI overhaul | — | ✅ [§7](#7-ui-overhaul-sprint-a3) |
| 11–12 | **M6** | ⏳ [§13](#13-phase-11--12--go-to-market) |

Feature detail for completed phases → [`README.md` § Features](README.md#features).

---

## 5. Tech stack

React + Vite + Tailwind · Fastify + TypeScript · PostgreSQL + Prisma · S3/MinIO · Clerk · AWS + Terraform · GitHub Actions.

Cron/Task Scheduler for detection today (BullMQ deferred — [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md)).

---

## 6. Product sprints (lifecycle-first)

Execution plan for the lifecycle-first product roadmap. Feature IDs map to [`PRODUCT_BACKLOG.md`](PRODUCT_BACKLOG.md).

| Sprint | Focus | Backlog IDs | Status |
|--------|--------|-------------|--------|
| **PS-0** | Desktop Clerk secrets in release pipeline | F14 | ✅ Done |
| **PS-1** | `GET /lifecycles` + homepage at `/` | F4′, F41, F44, F28, F32 | ✅ Done |
| **PS-2** | Expand-in-place timeline, filters, warnings, raw download | F25, F26, F9, F11, F55 | ✅ Done |
| **PS-3** | Ops dashboard at `/dashboard` | F1, F45–F48, F3 | ✅ Done |
| **PS-4** | Detection completion + run-detect UI | F2, F49, F50, F8 | ✅ Done |
| **PS-5** | Ingest triage + retry parse + startup reconcile | F5, F54, F6 | ✅ Done |
| **PS-6** | Settings hub, theme relocate, SLA toggles | F52, F20, F33, F13 | ✅ Done |
| **PS-7** | Channel health page + alerts polish | F10, F8, F33 | ✅ Done |
| **PS-8** | Typed 855/856 headers, glossary, parse feedback | F7, F31, F59, F60 | ✅ Done |
| **PS-9** | Ops notes, duplicate compare, raw export | F15, F56, F34, F37 | ✅ Verified |
| **PS-10** | Search lifecycle-first, saved views | F42, F16, F43 | ✅ Verified |
| **PS-11** | Audit viewer, email digest, dictionary UI, bulk CSV | F22, F51, F57, F19 | ✅ Verified |
| **PS-12** | Desktop LAN onboarding + Help menu | F39, F40, F61, F62 | ⏳ Partial |

**PS-1 deliverables (reference):**

- `GET /api/lifecycles` — paginated `LifecycleSummary[]` (default sort: `startedAt` desc)
- `/` → `LifecyclesPage`; `/transactions` → secondary drill-down
- Row summary: partner, flow, status counts, alert badge, parse-error badge (F32)
- Expand loads `GET /lifecycle?po=` on row expand (PS-2)

**PS-9 deliverables (verified 2026-06-25):**

- **F15** — `DuplicateComparePanel`: side-by-side raw EDI when multiple copies share set + direction
- **F56** — Ops notes on lifecycle expand panel (`GET/POST /lifecycles/:po/notes`)
- **F34** — `GET /lifecycles/:po/export?format=txt|csv|pdf` + `LifecycleExportMenu` on detail + expand
- **F37** — Invoice/shipment entry via `?invoice=` / search (scoped; no dedicated 810 multi-PO view)

**PS-10 deliverables (verified 2026-06-25):**

- **F42** — Search returns lifecycle conversations first (`SearchPage`)
- **F16** — Saved views: save/load/delete filter presets on `LifecyclesPage` via `GET/PATCH /preferences`
- **F43** — Pin POs (★), sort pinned to top, “Pinned only” filter with `pos` list API param

**PS-11 deliverables (verified 2026-06-25):**

- **F22** — Admin audit log viewer at `/admin/audit` (`AuditPage` + API tests)
- **F51** — Email digest job registered at boot; daily schedule per tenant; preview/live audit trail
- **F57** — Bulk export: CSV manifest + ZIP with txt/csv/pdf per selected PO
- **F19** — Segment label override editor on `PartnersConfigPage`

Approved features not yet grouped or deferred → [`PRODUCT_BACKLOG.md`](PRODUCT_BACKLOG.md).

---

## 7. UI overhaul (Sprint A3)

**Status:** ✅ Done — gates locked **A1 / B2 / C1** (2026-06-25; B revised to keep theme toggle).  
**Scope:** Readability for lifecycle + alerts only (no cosmetic churn).

### Decision gates (locked)

| Gate | Choice | Notes |
|---|---|---|
| **A — Accent** | **A1** indigo/slate | Brand tokens in `index.css` |
| **B — Dark mode** | **B2** light / system / dark toggle | Header `ThemeToggle`; persisted in localStorage |
| **C — Components** | **C1** shadcn on Lifecycle + Alerts | Card, StatusPill, PageHeader, etc. |

### Deliverables & exit criteria

**A3.1 Lifecycle:** ✅ Vertical timeline with gap warnings, duplicate badges, expandable AK3/AK4 detail, inline raw.

**A3.2 Alerts:** ✅ Row shows partner chip, human type label, age vs SLA pill, lifecycle deep link, ack/snooze.

**Out of scope:** Marketing site, desktop chrome, net-new API features.

---

## 8. Open remediation & architecture decisions

Completed audit items (W1.1, W1.2, W2.1–W2.3, W3.3, W3.4): production auth guardrails, tenant-scoped ISA dedup, multi-tenant detection, green CI, production `requireTenantId` throw, `clerk-nextjs` removed.

### W3.1 — Async queue (choose one, write ADR)

**Reality:** Ingestion is synchronous; detection/retention are cron scripts — not BullMQ.

- **Option A:** Add BullMQ + Redis (durable parse queue, worker scaling).  
- **Option B:** Keep sync pipeline; add startup reconcile for `RECEIVED` rows never parsed.

**Exit:** Docs match running code; Option B must leave no permanently-unparsed rows after restart.

### W3.2 — CORS

Decide same-origin (reverse proxy) vs split-origin. If split-origin, add `@fastify/cors` with config-driven allowlist.

### W4.x polish

Moved to [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md) (webhook reconcile, raw-file URL, parser scope docs).

---

## 9. Deploy track — staging & M5 proof

**When:** After architecture ADRs (W3.1/W3.2) and you schedule a deploy week. Local dev needs no AWS:

```bash
npm run infra:up && npm run db:migrate
npm run dev:api && npm run dev:web
```

### Sprint A1 — Staging environment

**Goal:** HTTPS API + RDS + S3 + Secrets Manager; Clerk staging app wired.

**Exit:** `curl https://<staging>/health` → 200; Clerk login works; one test ingestion in S3 + Postgres.

#### AWS prerequisites

- [ ] AWS account, IAM, Route 53 zone, region (default `us-east-1`)

#### Toolchain (one-time)

**Windows:** `winget install HashiCorp.Terraform Amazon.AWSCLI`  
**DB password:** `$env:TF_VAR_db_master_password = '...'` (PowerShell) or `export TF_VAR_...` (bash)

#### Terraform (from `infra/`)

```powershell
Copy-Item env/staging.tfvars.example env/staging.tfvars   # edit VPC/subnet/domain ids
cd infra
$env:TF_VAR_db_master_password = '...'
terraform init
terraform apply -target=aws_s3_bucket.raw_files -var-file=env/staging.tfvars
terraform apply -target=aws_kms_key.secrets -var-file=env/staging.tfvars
terraform apply -var-file=env/staging.tfvars
```

Check off [§10 Infrastructure](#infrastructure-apply-per-environment) as you go.

#### Secrets Manager

| Secret | Source |
|---|---|
| `DATABASE_URL` | RDS endpoint, `sslmode=require` |
| `CLERK_SECRET_KEY` | Clerk API keys |
| `CLERK_WEBHOOK_SECRET` | Clerk webhooks |
| `GLOBAL_SLACK_WEBHOOK` | Optional |

Full Clerk steps → [§11](#11-clerk-setup).

#### Clerk staging

- [ ] Create **EDI Data Hub (staging)** app; enable Organizations (Hobby+)
- [ ] Staging origins + webhook `https://<staging-domain>/webhooks/clerk`
- [ ] `VITE_CLERK_PUBLISHABLE_KEY` in web build env

#### API + web deploy

Terraform covers data plane (RDS, S3, ALB, secrets). Wire ECS/ECR or your container pattern; ALB health check `/readiness`; deploy web static assets.

#### Smoke test

Run checks in `infra/README.md` § "Verifying the security posture."

### Sprint A2 — Operational proof

Complete [§10 Phase 10 exit checklist](#phase-10-exit-checklist-m5--production-ready): restore drill → `ops/RESTORE_LOG.md`, k6 baseline → `ops/load/baseline.md`, security sign-off [§12](#12-security-checklist-sign-off), runbook cold-read, rate-limit 429 + audit row, retention task daily.

Tag `m5-production-ready` when all five exit items pass.

---

## 10. Pre-production operator checklist

Operator-only work before first external customer. Check off and date each line.

### Infrastructure apply (per environment)

- [ ] **Networking + storage**
  - [ ] `terraform apply -target=aws_s3_bucket.raw_files`
  - [ ] `terraform apply -target=aws_kms_key.secrets`
  - [ ] `env/<env>.tfvars` with VPC, subnets, domain, bucket; password via `TF_VAR_db_master_password`
  - [ ] Full `terraform apply -var-file=env/<env>.tfvars` (RDS, ALB, ACM, Secrets)
- [ ] **Secrets Manager** — `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, optional `GLOBAL_SLACK_WEBHOOK`
- [ ] **Clerk wiring** — [§11](#11-clerk-setup)
- [ ] **CloudWatch log group** — `infra/logs.tf`; ECS `awslogs-group` → `api_log_group_name`
- [ ] **Retention scheduled task** — daily 03:00 UTC; `RetentionRunSuccess` alarm (48 h)
- [ ] **Backups** — backup container to ECR; tfvars for backup buckets/image; SNS → Slack per `ops/RUNBOOKS.md`

### Operational drills (recurring)

- [ ] First restore drill → `ops/RESTORE_LOG.md` (quarterly)
- [ ] Synthetic alarm → Slack via SNS

### Pre-launch verification

- [ ] HTTPS smoke test per `infra/README.md`
- [ ] [§12 Security checklist](#12-security-checklist-sign-off) sign-off
- [ ] k6 baseline — two runs within 10% → `ops/load/baseline.md`
- [ ] Runbook cold-read → `ops/RUNBOOKS.md`
- [ ] Read `ops/SUPPORT.md`; name owners when team grows

### Phase 10 exit checklist (M5 — Production-ready)

- [ ] **Observability** — `/internal/metrics` scrapable; CloudWatch tenant-filtered logs
- [ ] **Backups proven** — real entry in `ops/RESTORE_LOG.md`
- [ ] **Retention running** — daily `retention.run` audit row per tenant
- [ ] **Rate limit live** — 429 + `Retry-After` in staging; `rate.exceeded` audit row
- [ ] **Runbooks usable** — cold-read complete; gaps fixed

---

## 11. Clerk setup

One-time per environment (dev, staging, prod). Values go in `.env` / Secrets Manager — never commit secrets.

### 1. Create application

[clerk.com](https://clerk.com) → **EDI Data Hub (dev|staging|prod)**. Auth: Email link + Google recommended.

### 2. Enable Organizations

Organizations → Settings → enable. Maps to `Tenant` rows. Requires **Hobby** plan ($25/mo) minimum.

### 3. API keys

| Variable | Source |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Dashboard → API Keys → `pk_test_...` or `pk_live_...` |
| `CLERK_SECRET_KEY` | `sk_test_...` or `sk_live_...` |

Web uses `@clerk/react`; provider reads `VITE_CLERK_PUBLISHABLE_KEY` from env automatically.

### 4. Webhook

Webhooks → Add endpoint:

- **Dev:** ngrok tunnel → `https://<tunnel>/webhooks/clerk`
- **Staging/prod:** `https://api.<domain>/webhooks/clerk`

Events: `organization.created`, `organization.updated`, `organizationMembership.created`, `organizationMembership.deleted`, optional `user.deleted`.

Copy signing secret → `CLERK_WEBHOOK_SECRET=whsec_...`

### 5. Env block

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...
```

### 6. Attach pilot org

After creating org in Clerk, attach existing pilot data:

```bash
npm run attach-pilot-org --workspace=@edi/api -- <clerk_org_id>
```

### 7. Verify

`npm run dev` → sign in → pilot data visible.

### Troubleshooting

- **No Tenant after webhook** — wrong `CLERK_WEBHOOK_SECRET` or env not loaded  
- **401 on API** — JWT not attached in `apps/web/src/lib/api.ts`  
- **404 cross-tenant** — `clerkOrgId` mismatch; check Clerk webhook log  
- **Organizations error** — upgrade from Free to Hobby  

**Production desktop releases:** use `pk_live_…` / `sk_live_…` before selling (see [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md) OPTIONAL-D1).

---

## 12. Security checklist (sign-off)

Sign-off for M4 (Sellable). Items are code-enforced or test-verified unless marked operator action.

**Last updated:** 2026-06-25 · Re-review with security advisor before first paid contract.

### Authentication

| # | Item | Status | Evidence |
|---|---|---|---|
| 1.1 | JWT required except `/health`, `/webhooks/clerk` | ✅ | `apps/api/src/plugins/tenant.ts` |
| 1.2 | Clerk SDK verification | ✅ | `apps/api/src/services/auth.ts` |
| 1.3 | Forged tokens → 401 | ✅ | `apps/api/test/isolation.test.ts` |
| 1.4 | Webhook Svix signature | ✅ | `apps/api/src/routes/webhooks.ts` |
| 1.5 | No dev-fallback in production | ✅ | `production-auth.test.ts`, `config.ts` |

### Tenant isolation

| # | Item | Status | Evidence |
|---|---|---|---|
| 2.1 | `tenantId NOT NULL` on all multi-tenant models | ✅ | `schema.prisma` |
| 2.2 | Prisma extension filters every query | ✅ | `tenant-extension.ts` |
| 2.3 | Schema drift test for new models | ✅ | `tenant-extension.test.ts` |
| 2.4–2.6 | Cross-tenant 404; audit scoped | ✅ | `isolation.test.ts` |
| 2.7 | `bypass()` only for admin/webhook paths | ✅ | grep `tenantContext.bypass` |
| 2.8 | `requireTenantId()` throws in production | ✅ | `tenant-context.test.ts` |

### RBAC

| # | Item | Status | Evidence |
|---|---|---|---|
| 3.1 | Every route has `requiredRole` | ✅ | `route-role-matrix.test.ts` |
| 3.2–3.4 | Hierarchy, 403, self-demotion guard | ✅ | `auth.test.ts`, `users.ts` |

### Audit logging

| # | Item | Status | Evidence |
|---|---|---|---|
| 4.1–4.4 | Mutations audited atomically; admin-only list | ✅ | `audit.test.ts`, `audit.ts` |

### Encryption in transit / at rest

| # | Item | Status | Evidence |
|---|---|---|---|
| 5.1–5.5 | TLS 1.3, HSTS, RDS SSL, S3 TLS-only | ✅ | `infra/alb.tf`, `rds.tf`, `s3.tf` |
| 6.1–6.4 | RDS/S3/Secrets KMS encryption | ✅ | Terraform + `storage/s3.ts` |

### Secrets, logging, headers, network

| # | Item | Status | Evidence |
|---|---|---|---|
| 7.1–7.3 | Secrets Manager in prod; `.env` in dev | ✅ | `secrets.ts` |
| 7.4 | ECS task KMS decrypt | ⚠️ Operator | `infra/secrets.tf` output |
| 8.1–8.2 | Structured logs, no PII default | ✅ | `server.ts` |
| 8.3 | Rate limiting | ✅ | Phase 10 code + `rate-limit.test.ts` |
| 9.1–9.3 | Security headers; ALB header scrub | ✅ | `security-headers.test.ts` |
| 10.1–10.3 | Private RDS; SG ingress; S3 block public | ✅ | `infra/rds.tf`, `s3.tf` |

### Sign-off

- [x] Item-by-item review complete  
- [x] All ✅ have code/test reference  
- [ ] Independent reviewer second-pass (recommended before first paid contract)

Deferred security items → [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md).

---

## 13. Phase 11 & 12 — go to market

### Phase 11 — Commercialization

**Blockers:** Gate 4 (self-serve Stripe vs direct sales); **Q7** (employer data rights); **Q11** (business entity).

**Scope:** Tiers, onboarding, customer docs, marketing site, ToS / Privacy / DPA.

### Phase 12 — First external customer (M6)

1–2 non-employer design partners → feedback → first paid contract.

---

## 14. Commands

```bash
npm install
npm run typecheck && npm run lint && npm run test:ci
npm run dev:api && npm run dev:web
npm run db:migrate --workspace=@edi/db
npm run infra:up    # Postgres + MinIO + SFTP
```
