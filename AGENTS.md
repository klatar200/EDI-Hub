# AI builder rules — EDI Data Hub

**Canonical rules for Cursor agents, Claude Code, Cloud Agents, and other AI-assisted builders.**

This file consolidates builder instructions that were previously scattered across `CLAUDE.md`, `.cursor/rules/*.mdc`, and sections of `BUILD_PLAN.md`. **When rules conflict, this file wins** unless the owner overrides in chat.

**Related (not duplicated here):** what's next → [`BUILD_PLAN.md`](BUILD_PLAN.md) · what's shipped → [`docs/SHIPPED.md`](docs/SHIPPED.md) · product context → [`docs/WIKI.md`](docs/WIKI.md) · local dev → [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md) · security sign-off → [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md) · security audit → [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md)

---

## Table of contents

1. [Product scope & anti-drift](#1-product-scope--anti-drift)
2. [Local-first, zero cost until go-live](#2-local-first-zero-cost-until-go-live)
3. [Git workflow — direct to main](#3-git-workflow--direct-to-main)
4. [CI verification gate](#4-ci-verification-gate)
5. [PowerShell CLI for the owner](#5-powershell-cli-for-the-owner)
6. [Architecture decisions agents must respect](#6-architecture-decisions-agents-must-respect)
7. [Multi-tenant invariants (Phase 9+)](#7-multi-tenant-invariants-phase-9)
8. [Security-sensitive change checklist](#8-security-sensitive-change-checklist)
9. [EDI domain rules (parser work)](#9-edi-domain-rules-parser-work)
10. [Commands reference](#10-commands-reference)
11. [Planning documentation](#11-planning-documentation)
12. [Source map](#12-source-map)

---

## 1. Product scope & anti-drift

**North Star:** Transaction lifecycle stitching — one PO number shows the 850, 855, 856, 810, and all 997s in chronological, status-aware order.

**Anti-drift rule:** Before adding any feature not in the build plan, confirm it serves **monitoring, troubleshooting, alerting, or stability**. If it does not, it is out of scope for v1.

**Principles:**

- De-risk parsing early; every phase should be demoable.
- **Raw file is sacred** — store verbatim before parse; parsing failures never lose the original.
- **Passive observability** — the hub receives *copies* of EDI; it never sits in the live transmission path.

**Active development track:** Local-only ($0). See [§2](#2-local-first-zero-cost-until-go-live). Paid AWS staging and go-live are deferred until the owner explicitly opts in.

---

## 2. Local-first, zero cost until go-live

The project owner develops on **Windows PowerShell in VS Code** and is **not** provisioning paid cloud infrastructure until the app is ready to go live.

### Default mode: local ($0)

| Need | Use (free) | Do not use (paid) |
|------|------------|-------------------|
| Database | Docker Postgres (`docker compose`) | AWS RDS |
| Object storage | MinIO (`docker compose`) | AWS S3 |
| API + web | `npm run dev:api` + `npm run dev:web` | ECS, ALB, ECR |
| Auth | Clerk **Free** + `pk_test_` in `.env`, or API **dev-fallback** | Clerk Hobby/Live, production keys |
| TLS / domain | `localhost` (Vite proxy) | Route 53, ACM, custom domain |
| Background jobs | Postgres `Job` table + local cron scripts | BullMQ, ElastiCache |
| IaC apply | **Do not run** `terraform apply` | AWS billable resources |

Canonical guide: [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md) · Roadmap local track: [`BUILD_PLAN.md` §3.1](BUILD_PLAN.md#31-active-track--local-development-0)

### Forbidden until go-live (unless owner explicitly asks)

Do **not** proactively suggest, plan, or implement:

- AWS account setup, `terraform apply`, RDS, ALB, ECS, Route 53, domains, Secrets Manager
- Paid Clerk tiers (Hobby/Pro) or `pk_live_` / `sk_live_` keys
- Redis/ElastiCache, BullMQ hosting, Datadog, PagerDuty, paid monitoring
- “Next step: staging deploy” as the default recommendation

`infra/` Terraform and [`infra/WINDOWS.md`](infra/WINDOWS.md) are **reference only** — go-live gate in [`BUILD_PLAN.md`](BUILD_PLAN.md) §4.

### When the owner says they are ready for go-live

Only then may agents suggest paid services, with explicit cost callouts and point to `BUILD_PLAN.md` §4 and `infra/WINDOWS.md`.

### Agent execution environment

Cloud Agents may run CI on GitHub (free for public repos). That is not “owner staging deploy.” Do not conflate CI with billing the owner’s AWS account.

---

## 3. Git workflow — direct to main

All Cursor agent work in this repository ships **directly to `main`**. Do not use pull requests or long-lived feature branches.

### Required workflow

1. **Start on `main`.** If on another branch or detached HEAD: `git checkout main` and `git pull origin main` before making changes.
2. **Implement on `main`.** Do not create `cursor/*` or other feature branches for agent work.
3. **Commit on `main`** with clear, descriptive commit messages (only when the user asks you to commit).
4. **Push to `origin main`:** `git push origin main` (only when the user asks you to push).
5. **CI is the gate.** See [§4](#4-ci-verification-gate).

### Forbidden

- Opening pull requests (draft or otherwise) for agent-completed work
- Using PR management tools (`ManagePullRequest`, label edits, etc.)
- Leaving work only on a feature branch without merging to `main`
- Asking the user to review or merge a PR for agent-completed work

### When blocked

- **Push rejected (non-fast-forward):** `git pull --rebase origin main`, resolve conflicts, push again.
- **Branch protection blocks direct push:** Tell the user branch protection must allow direct pushes to `main` (or allow the Cursor/GitHub Actions bot). Do not fall back to opening a PR unless the user explicitly overrides in chat.

### Scope

Applies to **Cursor agents** (local Agent/Composer and Cloud Agents). Human contributors may still use PRs.

---

## 4. CI verification gate

Local `npm run test:ci` is necessary but **not sufficient**. Before finishing a task, starting the next backlog sprint, or telling the user work is done:

1. **Push to `origin main`** (per [§3](#3-git-workflow--direct-to-main)).
2. **Watch the GitHub Actions `CI` workflow** for that push:
   - `gh run list --branch main --limit 3`
   - `gh run watch <run-id> --exit-status`
   - On failure: `gh run view <run-id> --log-failed` — fix on `main`, push again, repeat.
3. **Do not proceed** until the latest `main` CI run is **success** (both `Typecheck, Lint & Test` and `Playwright UI parity` jobs, unless parity is skipped via missing secret).

### Local pre-push gate

Run before every push:

```powershell
npm run test:ci
```

`test:ci` mirrors the CI build job: `db:generate`, `typecheck`, `lint`, all workspace tests, and `apps/web` production build.

### When CI fails after push

Fix on `main`, commit, push, and re-verify GitHub CI. Do not batch unrelated backlog work on a broken tree.

---

## 5. PowerShell CLI for the owner

The project owner **always uses PowerShell in VS Code on Windows**. When you give commands, setup steps, or copy-paste blocks **intended for the user to run locally**, use **PowerShell syntax only**.

### Required

- **Environment variables:** `$env:NAME = 'value'` — never `export NAME=...`
- **File copy:** `Copy-Item src dst` — not `cp`
- **Path changes:** `cd infra` or `Set-Location infra` — bash-only `&&` chains are OK in PowerShell 7+ but prefer separate lines or `;` for clarity
- **Installs (Windows):** `winget install ...` when suggesting local tool setup
- **Line continuation:** backtick `` ` `` at end of line, or single-line commands
- **Secrets in session:** `$env:TF_VAR_db_master_password = '...'` before Terraform

### Examples

```powershell
# Good
$env:TF_VAR_db_master_password = 'YourStrongPasswordHere'
$env:AWS_REGION = 'us-east-1'
Copy-Item infra\env\staging.tfvars.example infra\env\staging.tfvars
cd infra
terraform init
terraform apply -var-file=env/staging.tfvars
```

```powershell
# Bad — do not show the user bash syntax
export TF_VAR_db_master_password='...'
cp infra/env/staging.tfvars.example infra/env/staging.tfvars
```

### Docs and plans

- Operator/deploy docs (`BUILD_PLAN.md`, `infra/README.md`, runbooks): **PowerShell first**; optional bash in a collapsed “Linux/macOS” subsection only if both are needed.
- Full Windows staging walkthrough: [`infra/WINDOWS.md`](infra/WINDOWS.md)

### Agent execution environment

Cloud Agents and CI may run on Linux/bash internally — that is fine for automated runs. **Do not** paste bash-only instructions to the user when they are driving the terminal in VS Code on Windows.

---

## 6. Architecture decisions agents must respect

### Monorepo layout

```
/apps
  /web          # React + Vite frontend
  /api          # Fastify backend
/packages
  /edi-parser   # X12 parsing (pure TS, no framework deps)
  /db           # Prisma schema + generated client
  /shared       # Shared types
/infra          # Terraform (reference until go-live)
```

### Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite, Tailwind CSS, shadcn/ui |
| Backend | Node.js + Fastify, TypeScript |
| Database | PostgreSQL via Prisma ORM |
| Raw file storage | S3/MinIO locally; AWS S3 at go-live |
| Background jobs | Postgres `Job` table locally; BullMQ deferred ([ADR 0001](docs/adr/0001-w3.1-synchronous-ingestion-with-reconcile.md)) |
| Auth | Clerk (dev-fallback when `CLERK_SECRET_KEY` blank) |
| CI/CD | GitHub Actions |

TypeScript throughout — type errors at build time are cheaper than silent wrong values in production EDI.

### Key rules

| Rule | Detail |
|------|--------|
| Ingestion is passive | Copies via SFTP, upload, or folder-watch — never in the live path |
| Raw file is sacred | Store verbatim in object storage before parse; S3 key is primary reference |
| Parsing is isolated | All X12 logic in `packages/edi-parser` — no DB or HTTP deps |
| Typed transaction sets | Parser output matches TS types per set (850, 855, etc.) |
| Dedup on ISA control # | Same ISA control number ingested twice → one record |
| Multi-tenant | Phase 9+ — see [§7](#7-multi-tenant-invariants-phase-9) |

---

## 7. Multi-tenant invariants (Phase 9+)

Every change must preserve these four invariants. Violating any is a **security bug**, even if tests pass.

### 7.1 Every multi-tenant table carries `tenantId`

When adding a model to `schema.prisma`:

1. Add `tenantId String @map("tenant_id") @db.Uuid` and a relation to `Tenant`.
2. Add the model name to `MULTI_TENANT_MODELS` in `packages/db/src/tenant-extension.ts`.
3. Add `@@index([tenantId])` (or `[tenantId, createdAt]` if reads sort by date).

If a model should **not** carry `tenantId` (system tables), add it to `TENANT_EXEMPT_MODELS` with a comment. The schema-drift test (`packages/db/test/tenant-extension.test.ts`) fails if a new model is unclassified.

### 7.2 Every query runs inside a tenant context

The Prisma extension throws if `tenantContext.current()` is unset. Routes get context from `tenantPlugin`.

Scripts, jobs, and tests that bypass Fastify must use:

```ts
tenantContext.run({ tenantId }, async () => { ... })
```

or `tenantContext.bypass(...)` explicitly for cross-tenant work (audit-log writes and admin bootstrap only).

### 7.3 Every data-mutating route emits an audit row

Pattern (`apps/api/src/services/audit.ts`):

```ts
import { withAudit } from '../services/audit.js';

const updated = await withAudit(
  app.prisma,
  { action: 'partner.update', targetType: 'tradingPartner', actorId: request.auth?.userId ?? null },
  (tx) => tx.tradingPartner.update({ where: { id }, data: { ... } }),
  (row) => ({ targetId: row.id, before: existing, after: row }),
);
```

Audit insert is in the same `$transaction` as the write. Do not add mutating routes without `withAudit`.

### 7.4 Every route declares `requiredRole`

```ts
app.get('/things', requiresRole('viewer'), async (req, reply) => { ... });
```

`apps/api/test/route-role-matrix.test.ts` enumerates every route — add an `EXPECTED[…]` entry when registering a new route.

### Cross-tenant probes return 404, not 403

Never confirm existence of a foreign-tenant row. Prisma `where`-injection produces 404; P2025 on update should surface NOT_FOUND, not FORBIDDEN.

### Secrets

Production reads from AWS Secrets Manager (`apps/api/src/services/secrets.ts`). New secrets: extend `applySecretsFromManager`, add `aws_secretsmanager_secret` in `infra/secrets.tf`, document in deploy README. **Never inline secret values.**

---

## 8. Security-sensitive change checklist

When your change touches auth, tenancy, RBAC, audit, rate limits, headers, or public routes:

1. Read [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md) — sign-off items with file/test evidence.
2. Update the matching test or checklist row if behavior changes.
3. See [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) for local vs go-live remediation priorities.

**Public routes (no JWT):** `GET /health`, `GET /readiness`, `GET /internal/metrics`, `POST /webhooks/clerk` — defined in `apps/api/src/plugins/tenant.ts` `PUBLIC_ROUTES`. Do not add public data routes without explicit review.

---

## 9. EDI domain rules (parser work)

- **Envelope hierarchy:** ISA → GS → ST/SE. Parse outer-in.
- **Primary X12 version:** 4010. Surface version from GS08; handle 5010 gracefully.
- **Transaction sets in scope (v1):** 850, 855, 856, 810, 997/999.
- **997 AK segments:** AK1–AK5, AK3/AK4 error detail — parse carefully; powers Phase 5 troubleshooting.
- **Real-world EDI is messy:** non-standard delimiters, omitted segments, repeated segments, Z-segments. Fail gracefully — log, store raw file, never crash the pipeline.
- **Delimiters from ISA:** element separator ISA[3], sub-element ISA[16], segment terminator after ISA[16]. Do not hardcode `*`, `~`, or `:`.

---

## 10. Commands reference

```powershell
# Install (repo root)
npm install

# Dev servers
npm run dev --workspace=apps/api    # API — default :3000
npm run dev --workspace=apps/web    # Web — http://localhost:5173

# Quality gates
npm run typecheck
npm run lint
npm test
npm run test:ci                     # Pre-push + mirrors CI build job
npm run validate:local              # Docker stack smoke

# Database
npm run db:migrate --workspace=packages/db
npm run db:generate --workspace=packages/db

# Clerk provisioning (when using Clerk keys locally)
npm run attach-pilot-org --workspace=@edi/api -- org_xxxxxxxx
npm run seed-pilot-admin --workspace=@edi/api -- user_xxx you@example.com admin
npm run reconcile-clerk --workspace=@edi/api
```

Full local walkthrough: [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md)

---

## 11. Planning documentation

Keep planning docs **split by purpose** so “what’s next?” stays small and completed work does not look like open work.

### Where each kind of content lives

| Doc | Content | Read when |
|-----|---------|-----------|
| [`BUILD_PLAN.md`](BUILD_PLAN.md) | **Future only** — checkboxes, status, links, deferred sprints | “What should I build or verify next?” |
| [`docs/SHIPPED.md`](docs/SHIPPED.md) | **Completed** phases, sprints, feature matrix, backlog history | “Was X already built?” / “Which sprint shipped F27?” |
| [`docs/WIKI.md`](docs/WIKI.md) | **Narrative** — North Star, principles, stack, doc map | Product context without sprint clutter |
| [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md) | Security sign-off table | Pre-launch or security-sensitive changes |
| [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) | Audit findings + remediation detail | Security investigation |

**Recommendation:** Keep `BUILD_PLAN.md` lean and action-oriented (checkboxes, status, links). Put narrative and principles in `docs/WIKI.md`. Put history in `docs/SHIPPED.md`. That way an agent doing “what’s next?” loads a small file and does not confuse completed sprints with open work.

### Maintenance rules (mandatory)

1. **When a sprint ships** → update [`docs/SHIPPED.md`](docs/SHIPPED.md), **not** `BUILD_PLAN.md`.
2. **When planning new optional/future work** → add to [`BUILD_PLAN.md` §5](BUILD_PLAN.md#5-future--optional-features) only.
3. **Do not recreate** completed sprint tables or F1–F62 matrices in `BUILD_PLAN.md`.
4. **Security sign-off** → [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md) stays separate; do not merge into `BUILD_PLAN.md`.
5. **Redirect stubs** (e.g. `docs/FEATURE_STATUS.md`) point at canonical locations — update the target doc, not the stub.

### Do not duplicate

Do not add new planning markdown files for sprints, phases, or backlog unless the owner explicitly asks. Link to the table above instead.

---

## 12. Source map

This file absorbed builder rules from the locations below. **Do not duplicate these rules in new docs** — link here instead.

| Former location | Topics now in |
|-----------------|---------------|
| [`CLAUDE.md`](CLAUDE.md) | §1, §6, §7, §9, §10 (project + tenancy + EDI) |
| [`.cursor/rules/direct-to-main.mdc`](.cursor/rules/direct-to-main.mdc) | §3 |
| [`.cursor/rules/verify-github-ci.mdc`](.cursor/rules/verify-github-ci.mdc) | §4 |
| [`.cursor/rules/local-first-zero-cost.mdc`](.cursor/rules/local-first-zero-cost.mdc) | §2 |
| [`.cursor/rules/powershell-cli.mdc`](.cursor/rules/powershell-cli.mdc) | §5 |
| [`BUILD_PLAN.md`](BUILD_PLAN.md) §2, §4 | §1, §2 (scope + cost policy) |
| [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md) § “What you are NOT doing” | §2 |
| [`infra/README.md`](infra/README.md) header | §2 |
| [`ops/RUNBOOKS.md`](ops/RUNBOOKS.md) audit policy refs | §7.3 |
| Planning doc split (`BUILD_PLAN` / `SHIPPED` / `WIKI`) | §11 |

**Cursor still loads `.cursor/rules/*.mdc` automatically** (`alwaysApply: true`). Those files are kept in sync with this document; if they diverge, **update `AGENTS.md` first**, then mirror to `.mdc`.
