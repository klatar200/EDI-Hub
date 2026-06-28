# EDI Data Hub — Build Plan & Roadmap

**Owner:** Keagan  
**Last updated:** 2026-06-27  
**Status:** Phases **0–10** and **desktop track** code-complete. **Product backlog complete.** **Active track: local development ($0).** AWS staging and go-live are **deferred** until the owner is ready.

> **Active planning lives here.** **Local dev guide:** [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md). Shipped capabilities → [`README.md`](README.md#features). Optional ideas → [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md). **Paid AWS deploy** → [§9](#9-deploy-track--go-live-gate--deferred) (do not run until go-live).

---

## Table of contents

1. [Current snapshot](#1-current-snapshot)
2. [North Star & principles](#2-north-star--principles)
3. [Roadmap — what's next](#3-roadmap--whats-next)
3.1. [Active track — local development ($0)](#31-active-track--local-development-0)
4. [Phase & milestone map](#4-phase--milestone-map)
5. [Tech stack](#5-tech-stack)
6. [Completed product sprints (reference)](#6-completed-product-sprints-reference)
7. [UI overhaul (Sprint A3)](#7-ui-overhaul-sprint-a3)
8. [Open remediation & architecture decisions](#8-open-remediation--architecture-decisions)
9. [Deploy track — go-live gate (deferred)](#9-deploy-track--go-live-gate--deferred)
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
| **Tests** | **436** — 46 db · 48 parser · 256 api · 61 web · 25 desktop |
| **CI** | typecheck · lint (0 warnings) · `test:ci` green |
| **Product backlog** | ✅ PS-0–PS-12 + PB-1–PB-8 complete — [`docs/FEATURE_STATUS.md`](docs/FEATURE_STATUS.md) |
| **Production** | 🔒 Deferred until go-live — [§9](#9-deploy-track--go-live-gate--deferred) |
| **Next focus** | **Security remediation** → [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) Sprint SEC-1 (after local stack runs) |

**M5 in code ≠ M5 in production.** Operator drills (restore, k6 baseline, runbook cold-read) run at **go-live**, not during local-only development.

**Cost policy:** No paid AWS, domains, or Clerk production tiers until the owner declares go-live readiness. Cursor rule: `.cursor/rules/local-first-zero-cost.mdc`.

---

## 2. North Star & principles

**North Star:** *Transaction lifecycle stitching* — one PO number shows 850, 855, 856, 810, and all 997s in chronological, status-aware order.

**Anti-drift rule:** New work must serve monitoring, troubleshooting, alerting, or stability.

**Principles:** De-risk parsing early · every phase demoable · raw file is sacred · passive observability (copies only, never live path) · **local-first until go-live** (zero cloud spend during development).

---

## 3. Roadmap — what's next

**Product features:** All approved backlog items are shipped ([`docs/FEATURE_STATUS.md`](docs/FEATURE_STATUS.md)).

**Infrastructure:** **Local only** until go-live. Do not provision AWS staging.

| # | Workstream | Status |
|---|---|---|
| 1 | Path A-core remediation | ✅ Done |
| 2 | Manual import UI | ✅ Done |
| 3 | Lifecycle duplicates UI | ✅ Done |
| 4 | UI overhaul — Sprint A3 | ✅ Done → [§7](#7-ui-overhaul-sprint-a3) |
| 5 | Product sprints PS-0–PS-12 + PB-1–PB-8 | ✅ Done → [§6](#6-completed-product-sprints-reference) |
| 6 | Queue + CORS architecture ADRs | ✅ Done → [§8](#8-open-remediation--architecture-decisions) · [`docs/adr/`](docs/adr/) |
| 7 | **Local dev validation ($0)** | ⏳ Active → [§3.1](#31-active-track--local-development-0) |
| 7b | **Security audit remediation** | ⏳ SEC-3 (go-live) → [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) (SEC-1–4 shipped) |
| 8 | Optional polish | 📋 [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md) — only if it serves stability/UX |
| 9 | Staging deploy (Sprint A1) | 🔒 **Deferred (go-live)** → [§9](#9-deploy-track--go-live-gate--deferred) |
| 10 | M5 operational proof (Sprint A2) | 🔒 **Deferred (go-live)** → [§10](#10-pre-production-operator-checklist) |
| 11 | Phase 11 commercialization | 🔒 **Deferred** → [§13](#13-phase-11--12--go-to-market) |
| 12 | Phase 12 external pilot (M6) | 🔒 **Deferred** → [§13](#13-phase-11--12--go-to-market) |

---

## 3.1 Active track — local development ($0)

**Goal:** Run the full hub on your machine — no AWS bill, no domain, no `terraform apply`.

**Guide:** [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md) (PowerShell / VS Code).

### Stack (local substitutes)

| Production | Local (free) |
|---|---|
| RDS Postgres | Docker Postgres (`docker-compose.yml`) |
| S3 | MinIO (`docker-compose.yml`) |
| ECS + ALB + ACM | `npm run dev:api` + `npm run dev:web` (Vite proxies `/api`) |
| Secrets Manager | `.env` (from `.env.example`) |
| Clerk production | Clerk **Free** `pk_test_` / `sk_test_`, or API **dev-fallback** (no keys) |
| SFTP / AS2 | Optional local channels via `docker compose` |

### Quickstart (PowerShell)

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d
npm run db:migrate
npm run dev:api    # terminal 1 — http://localhost:3000
npm run dev:web    # terminal 2 — http://localhost:5173
```

### Exit criteria (local track)

- [ ] `npm run test:ci` green
- [ ] Sign in (Clerk or dev-fallback) and see lifecycles UI
- [ ] Upload or SFTP-drop a test 850; appears in lifecycle list
- [ ] Alerts/detection runnable locally (`npm run detect --workspace=@edi/api` or dashboard)

### Explicitly out of scope until go-live

- AWS account, Terraform apply, Route 53, staging URL
- Clerk Hobby/Organizations billing (unless you choose it for multi-org testing)
- k6 against staging, restore drills on RDS, CloudWatch — [§10](#10-pre-production-operator-checklist)

Low-priority polish → [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md).

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

**Local development (active — $0):** React + Vite · Fastify · Postgres (Docker) · MinIO · Clerk Free or dev-fallback · GitHub Actions CI.

**Production (deferred until go-live):** AWS RDS + S3 + ECS + ALB · Secrets Manager · Terraform in `infra/` · Clerk Hobby+ for Organizations.

Cron/Task Scheduler for detection locally (BullMQ deferred — [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md)).

---

## 6. Completed product sprints (reference)

Historical execution plan for the lifecycle-first product roadmap. **All sprints below are complete.** Feature IDs map to [`PRODUCT_BACKLOG.md`](PRODUCT_BACKLOG.md). Live status → [`docs/FEATURE_STATUS.md`](docs/FEATURE_STATUS.md).

### Product sprints (PS-0–PS-12)

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

### Backlog completion sprints (PB-1–PB-8)

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

**Key deliverables (summary):**

- Homepage = paginated lifecycle list with expand-in-place timeline, filters, saved views, pins, SLA countdown, due dates
- Ops dashboard, alerts (filter, bulk ack, run detection), channel health, settings hub
- Search → lifecycle first; invoice/shipment entry points; multi-PO invoice linking on 810/880
- Export (txt/csv/pdf, bulk ZIP, optional raw EDI); audit viewer; email digest; ops notes
- Tier A + Tier B transaction sets (850–997 + 860/875/880) parsed and productized
- Desktop: LAN wizard, Help hub, Clerk in releases, auto-update

Deferred or optional ideas → [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md).

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

### W3.1 — Async queue ✅ Accepted

**ADR:** [`docs/adr/0001-w3.1-synchronous-ingestion-with-reconcile.md`](docs/adr/0001-w3.1-synchronous-ingestion-with-reconcile.md)

**Decision:** **Option B** — synchronous inline parse on ingest + startup reconcile for stuck `RECEIVED` rows. No BullMQ/Redis for M5. Background jobs stay on the Postgres `Job` table adapter.

**Revisit:** When ingest volume or CPU isolation requires a dedicated parse-worker tier — see ADR for criteria.

### W3.2 — CORS ✅ Accepted

**ADR:** [`docs/adr/0002-w3.2-same-origin-default-cors-escape-hatch.md`](docs/adr/0002-w3.2-same-origin-default-cors-escape-hatch.md)

**Decision:** **Same-origin default** — API serves React build via `WEB_STATIC_DIR` on one hostname for staging/M5. **`CORS_ALLOWED_ORIGINS`** only when deliberately splitting `app.` and `api.` hosts.

### W4.x polish

Moved to [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md) (webhook reconcile, raw-file URL, parser scope docs).

---

## 9. Deploy track — go-live gate (deferred)

> 🔒 **NOT ACTIVE.** Owner policy: **no paid cloud spend** until the app is ready to go live.  
> **Do not** run `terraform apply`, create an AWS account for this project, or buy a domain during local development.  
> **When ready:** follow [`infra/WINDOWS.md`](infra/WINDOWS.md) (PowerShell) — expect ~**$40–60+/month** for minimal always-on staging (ALB + RDS + Fargate) plus domain/hosted zone fees.

**Local substitute (use now):** [§3.1](#31-active-track--local-development-0) · [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md)

```powershell
npm run infra:up
npm run db:migrate
npm run dev:api
npm run dev:web
```

### Sprint A1 — Staging environment (go-live only)

**Goal:** HTTPS API + RDS + S3 + Secrets Manager; Clerk staging app wired.

**Exit:** `curl https://<staging>/health` → 200; Clerk login works; one test ingestion in S3 + Postgres.

#### AWS prerequisites

- [ ] AWS account, IAM, Route 53 zone, region (default `us-east-1`)

#### Toolchain (one-time)

**PowerShell (VS Code on Windows):** full walkthrough → [`infra/WINDOWS.md`](infra/WINDOWS.md)

```powershell
winget install HashiCorp.Terraform Amazon.AWSCLI
# Close and reopen PowerShell, then:
terraform version
aws configure
$env:TF_VAR_db_master_password = 'YourStrongPasswordHere'
```

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

Terraform covers data plane (RDS, S3, ALB, secrets). Wire ECS/ECR or your container pattern; ALB health check `/readiness`.

**Web + API (per [ADR 0002](docs/adr/0002-w3.2-same-origin-default-cors-escape-hatch.md)):** bake `apps/web/dist` into the API image and set `WEB_STATIC_DIR`. Serve from the same hostname as the API — do **not** set `CORS_ALLOWED_ORIGINS`. Clerk authorized origin = that single public URL.

Split-origin (CloudFront + `api.` subdomain) is supported via `CORS_ALLOWED_ORIGINS` + `VITE_API_URL` at build time — see ADR 0002 escape hatch.

#### Smoke test

Run checks in `infra/README.md` § "Verifying the security posture."

### Sprint A2 — Operational proof

Complete [§10 Phase 10 exit checklist](#phase-10-exit-checklist-m5--production-ready): restore drill → `ops/RESTORE_LOG.md`, k6 baseline → `ops/load/baseline.md`, security sign-off [§12](#12-security-checklist-sign-off), runbook cold-read, rate-limit 429 + audit row, retention task daily.

Tag `m5-production-ready` when all five exit items pass.

---

## 10. Pre-production operator checklist

🔒 **Deferred until go-live.** Complete after [§9](#9-deploy-track--go-live-gate--deferred) when accepting AWS costs.

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

### Local development ($0)

| Approach | Cost | When |
|----------|------|------|
| **Dev-fallback** | Free | Leave `CLERK_SECRET_KEY` blank — API pins pilot tenant; good for parser/UI work |
| **Clerk Free + test keys** | Free | Real sign-in UI with `pk_test_` / `sk_test_` in `.env` |

Copy `.env.example` → `.env`. See [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md).

### Staging / production (go-live — paid tiers may apply)

One-time per environment. Values go in `.env` (local) or Secrets Manager (AWS) — never commit secrets.

### 1. Create application

[clerk.com](https://clerk.com) → **EDI Data Hub (dev|staging|prod)**. Auth: Email link + Google recommended.

### 2. Enable Organizations

Organizations → Settings → enable. Maps to `Tenant` rows. Requires **Clerk Hobby** ($25/mo) — **defer until go-live**; not required for local dev-fallback or single-org testing.

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

```powershell
npm run attach-pilot-org --workspace=@edi/api -- org_xxxxxxxx
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

🔒 **Deferred** until local product is validated and [§9](#9-deploy-track--go-live-gate--deferred) staging is live.

### Phase 11 — Commercialization

**Blockers:** Gate 4 (self-serve Stripe vs direct sales); **Q7** (employer data rights); **Q11** (business entity).

**Scope:** Tiers, onboarding, customer docs, marketing site, ToS / Privacy / DPA.

### Phase 12 — First external customer (M6)

1–2 non-employer design partners → feedback → first paid contract.

---

## 14. Commands

**Local (PowerShell — active):**

```powershell
npm install
Copy-Item .env.example .env
npm run infra:up
npm run db:migrate
npm run dev:api
npm run dev:web
npm run typecheck
npm run lint
npm run test:ci
```

See [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md).
