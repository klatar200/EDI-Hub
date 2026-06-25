# EDI Data Hub — Remediation Build Plan

**Owner:** Keagan
**Author:** Generated from a full-codebase audit (2026-06-22)
**Status:** Proposed
**Scope:** Resolve every gap and error surfaced in the state-of-the-app review. Ordered by risk, not by effort.

---

## How to read this plan

Each item has: **Severity**, the **root cause** (with file references), the **fix**, the **files touched**, and an **exit criterion** that proves it's resolved. Work the workstreams top to bottom — W1 (Critical) blocks any non-pilot deployment and should land before anything else.

The audit confirmed the core is healthy: typecheck is clean, `edi-parser` passes 46/46, `@edi/db` passes 15/15, and the tenant-isolation extension is sound. These fixes are concentrated in production-safety guardrails and multi-tenant completeness — the "less compressible" back half the build plan anticipated.

**Verification baseline (run before starting, to confirm the audit):**

```bash
npm run typecheck      # expected: clean
npm run lint           # expected: 40 errors (this plan fixes them)
npm test --workspace=@edi/edi-parser   # expected: 46 pass
npm test --workspace=@edi/db           # expected: 15 pass
```

> Note: running the JS test/lint toolchain on a different OS than `node_modules` was installed on will fail with an esbuild/rollup platform-binary error. Run `npm install` (or `npm ci`) on the target OS first.

---

## Workstream W1 — Critical (blocks production / multi-tenant)

### W1.1 — Enforce auth configuration in production

**Severity:** Critical (silent auth bypass)

**Root cause:** `apps/api/src/config.ts` loads `CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SECRET` via `optional(..., '')`. A blank secret puts `plugins/tenant.ts` into `dev-fallback` (lines 77–87): every request is pinned to `PILOT_TENANT_ID` with `request.auth = null`, and the RBAC check at line 174 (`if (required && request.auth && …)`) treats `null` as implicit admin. A production deploy that forgets the key boots as **unauthenticated, full-admin, pilot-tenant**. `nodeEnv` is read but never used to prevent this. Code comments claim "production fails boot" — but no code enforces it.

**Fix:**
1. In `loadConfig()`, after assembling config, add a guard: when `nodeEnv === 'production'`, throw if `clerk.secretKey`, `clerk.webhookSecret`, or `clerk.publishableKey` is blank. Fail fast at boot with a clear message.
2. In `plugins/tenant.ts`, make `dev-fallback` impossible outside development: if `outcome.kind === 'dev-fallback'` and `nodeEnv === 'production'`, return `500 AUTH_MISCONFIGURED` instead of pinning to the pilot tenant. (Defense in depth — the boot guard should already prevent reaching here.)
3. Add a one-line startup log stating which auth mode is active (`clerk` vs `dev-fallback`) so the mode is never ambiguous in logs.

**Files:** `apps/api/src/config.ts`, `apps/api/src/plugins/tenant.ts`

**Exit criterion:** Booting with `NODE_ENV=production` and any Clerk secret blank exits non-zero with a clear error. A new test asserts the boot guard throws; an integration test asserts a request in a simulated prod + missing-key state returns 500, not 200.

---

### W1.2 — Scope ISA control-number dedup to the tenant

**Severity:** Critical (cross-tenant data loss)

**Root cause:** `packages/db/prisma/schema.prisma` declares `isaControlNumber String? @unique` — a **global** constraint. Dedup in `apps/api/src/services/ingestion.ts:127` does `findUnique({ where: { isaControlNumber } })`. ISA control numbers are per-sender 9-digit counters that collide across trading partners and across tenants as a matter of course. Today the second tenant to use a given control number is either treated as a duplicate (file silently dropped) or hits a unique-constraint violation on insert → stranded in S3 as a `db_error`. Either way the transaction never appears in the hub.

**Fix:**
1. Change the schema to a composite unique: replace `@unique` on `isaControlNumber` with `@@unique([tenantId, isaControlNumber])`. Consider including the ISA sender ID as well (`@@unique([tenantId, isaSenderId, isaControlNumber])`) so two partners within one tenant can't collide either — requires persisting the sender ID on `raw_files`.
2. Update dedup in `ingestion.ts` to look up by the compound key (`findUnique({ where: { tenantId_isaControlNumber: { tenantId, isaControlNumber } } })`), or switch to `findFirst` so the tenant extension's `where` injection composes cleanly.
3. Write a Prisma migration. Before applying, audit existing `raw_files` for control numbers that would now be permitted but were previously blocked; backfill `sender_id` if added.

**Files:** `packages/db/prisma/schema.prisma`, a new migration under `packages/db/prisma/migrations/`, `apps/api/src/services/ingestion.ts`, ingestion tests.

**Exit criterion:** A test ingests the same ISA control number under two different tenants and gets two stored rows (no duplicate, no `db_error`). Re-ingesting the same file under the same tenant is still idempotent (one row).

---

## Workstream W2 — High (functional completeness + CI health)

### W2.1 — Make detection/alerting multi-tenant

**Severity:** High (Phase 7 / M3 broken for all but the pilot)

**Root cause:** `apps/api/src/scripts/run-detection.ts:25` hardcodes `tenantContext.run({ tenantId: PILOT_TENANT_ID }, …)`. Every tenant except the pilot receives zero missing-ack and rejection-spike alerts. `run-retention.ts` already iterates all active tenants, so the two background workers are inconsistent.

**Fix:**
1. Refactor `run-detection.ts` to enumerate active tenants (mirror `runRetention`'s pattern: query the Tenant table under `tenantContext.bypass`, then run each detection pass inside that tenant's `tenantContext.run`).
2. Aggregate and log per-tenant emitted/notified counts.
3. Ensure partner SLA windows and rejection baselines are read inside each tenant's context (they already are, via `requireTenantId`, once the context is set correctly).

**Files:** `apps/api/src/scripts/run-detection.ts` (and `services/detection.ts` only if a tenant list helper is extracted).

**Exit criterion:** A test seeding two tenants, each with an overdue expected ack, produces alerts for both. Per-tenant counts appear in the run log.

---

### W2.2 — Green the CI pipeline

**Severity:** High (CI red on every push)

**Root cause:** `.github/workflows/ci.yml` runs `npm run lint`, which currently emits 40 errors. Two are real source issues; the rest are ESLint scanning files it shouldn't.

**Fix:**
1. **Fix real source lint errors:**
   - `apps/api/src/routes/partners-config.ts:35` — replace the inline `import()` type annotation with a top-level `import type { … }`.
   - `apps/api/src/services/secrets.ts:70` — change `@ts-ignore` to `@ts-expect-error` (with a short reason).
2. **Stop linting generated/vendored files:** add ESLint ignores for `clerk-nextjs/**` (especially `.next/**`), `**/dist/**`, and `ops/load/k6/**`. For the k6 scripts that legitimately use the `__ENV` global, either ignore the directory or add a k6 env/globals override block rather than ignoring — your call.
3. Remove the now-unused `eslint-disable` directive flagged in `packages/db/src/tenant-context.ts:87` (the one-line warning).
4. Re-run `npm run lint` → expect 0 errors.

**Files:** `eslint.config.mjs`, `apps/api/src/routes/partners-config.ts`, `apps/api/src/services/secrets.ts`, `packages/db/src/tenant-context.ts`.

**Exit criterion:** `npm run lint` exits 0 locally and in CI.

---

### W2.3 — Verify CI actually runs the test suite it claims

**Severity:** High (CI may be passing vacuously)

**Root cause:** `ci.yml` runs `npm test` (parser + api + web) with no `services:` block. The api tests inject fake Prisma/S3 clients (`buildServer` supports this), so they may not need a real Postgres — but this is unverified, and the web/vitest run wasn't confirmed end-to-end in the audit (blocked by the OS platform-binary issue locally).

**Fix:**
1. Confirm the api test suite runs green in CI without external services. If any test reaches a real DB/S3/Redis, either add a Postgres service to the workflow or convert the test to injected fakes.
2. Confirm `npm test` includes the web (vitest) workspace and that it passes in CI.
3. Pin Node to 20 consistently (workflow uses 20; local audit ran on 22 — fine, but state the supported version in `package.json` `engines` and the README).

**Files:** `.github/workflows/ci.yml`, possibly `apps/api/test/*`.

**Exit criterion:** A CI run on a throwaway branch goes fully green (typecheck + lint + test + web build), and the test step demonstrably executes the api + web suites (visible test counts in the log).

---

## Workstream W3 — Medium (architecture drift + deployment correctness)

### W3.1 — Reconcile the async-queue architecture with reality

**Severity:** Medium (documented design not implemented)

**Root cause:** `CLAUDE.md` states ingestion and Phase 7 detection run on "BullMQ (Redis-backed)" with retry/failure handling. In reality ingestion is synchronous (the in-process promise chain in `apps/api/src/channels/drop-folder.ts`), and detection/retention are one-shot scripts meant for cron/Task Scheduler. Consequences: no durable queue, no worker scaling, and in-flight parse work is lost on process restart (raw bytes are safe in S3, but the parse is never retried).

**Fix — choose one and record it in an ADR:**
- **Option A (build it):** introduce BullMQ + Redis. Ingestion enqueues a parse job after the raw file is stored; a worker process drains the queue with retry/backoff. Reuse the same queue for detection scheduling. Add Redis to `docker-compose.yml` and to infra.
- **Option B (defer it):** keep the synchronous pipeline for now, but update `CLAUDE.md` and `BUILD_PLAN.md` to describe the actual design, and add a lightweight durability net: on startup, re-scan `raw_files` in `RECEIVED` status with no parsed interchange and re-run parse (covers restart-during-parse).

**Files:** `CLAUDE.md`, `BUILD_PLAN.md`, plus (Option A) `apps/api/src/channels/*`, a new worker entrypoint, `docker-compose.yml`, `infra/`; or (Option B) a small reconcile script under `apps/api/src/scripts/`.

**Exit criterion:** The stated architecture matches the running code. If Option B, killing the API mid-parse and restarting leaves no permanently-unparsed `RECEIVED` rows.

---

### W3.2 — Decide and configure CORS

**Severity:** Medium (cross-origin browser calls fail in prod)

**Root cause:** No `@fastify/cors` is registered in `apps/api/src/server.ts`. Dev works because Vite proxies `/api`; a production split-origin deployment (e.g. `app.example.com` → `api.example.com`) would have browser requests blocked.

**Fix:**
1. Decide the production topology: same-origin (reverse proxy in front of both) vs split-origin.
2. If split-origin, register `@fastify/cors` with an allowlist driven by config (`WEB_ORIGIN`), `credentials: true` if cookies are ever used, and restrict methods/headers to what the API needs (`Authorization`, `Content-Type`).
3. Document the decision in the deploy README.

**Files:** `apps/api/src/server.ts`, `apps/api/src/config.ts`, deploy README.

**Exit criterion:** From the intended production web origin, a browser request to the API succeeds (or, for same-origin, the README states CORS is intentionally absent and why).

---

### W3.3 — Make `requireTenantId()` fail loudly in production

**Severity:** Medium (latent cross-tenant write footgun)

**Root cause:** `packages/db/src/tenant-context.ts:82` returns `PILOT_TENANT_ID` (with a one-time warning) when no context is set. It stamps `tenantId` on writes in `ingestion.ts`, `parsing.ts`, `alerts.ts`, `audit.ts`. Any future code path that loses its context writes into the pilot tenant instead of failing.

**Fix:**
1. Keep the test-friendly fallback, but throw instead of falling back when `NODE_ENV === 'production'`.
2. Promote the one-time `console.warn` to a structured logger warning (or counter) so a missing-wrapper path is observable, not just printed once.

**Files:** `packages/db/src/tenant-context.ts`, its test.

**Exit criterion:** In a simulated production env, calling `requireTenantId()` with no context throws; tests with fake clients still pass via the retained dev/test fallback.

---

### W3.4 — Fix the embedded `clerk-nextjs` repo

**Severity:** Medium (repo hygiene / CI noise / reproducibility)

**Root cause:** `clerk-nextjs/` is a nested git repo (its own `.git`, no `.gitmodules`) that also commits its `.next/` build output — the source of much of the lint noise and a non-reproducible checkout (CI won't fetch a bare gitlink).

**Fix — choose one:**
- Convert to a proper git submodule (`.gitmodules` + recorded SHA) if it must travel with the repo, **or**
- Remove it from the repo entirely if it was only a reference sample, **or**
- If it stays vendored, delete the nested `.git`, add it as plain tracked files, and gitignore its `.next/` build output.

**Files:** `clerk-nextjs/` (and `.gitignore` / `.gitmodules` as appropriate).

**Exit criterion:** `git status` is clean, a fresh clone reproduces the same tree, and `clerk-nextjs/.next` is no longer tracked or linted.

---

## Workstream W4 — Low / polish

### W4.1 — Webhook out-of-order delivery recovery

**Severity:** Low

**Root cause:** `apps/api/src/routes/webhooks.ts:151` logs and 200s when a membership event arrives before its org, leaving the user unprovisioned. The remedy named in the comment ("a manual reconcile script") does not exist in `apps/api/src/scripts/`.

**Fix:** Add a `reconcile-clerk.ts` script that re-pulls orgs/memberships from Clerk and upserts missing Tenants/Users, **or** buffer unmatched membership events for retry. At minimum, create the script the comment promises.

**Files:** new `apps/api/src/scripts/reconcile-clerk.ts`.

**Exit criterion:** Delivering a membership event before its org, then running the reconcile, results in a provisioned user.

---

### W4.2 — Authenticated raw-file URL

**Severity:** Low

**Root cause:** `apps/web/src/lib/api.ts:196` `rawFileContentUrl` returns a bare URL with no `Authorization` header; if rendered in an `<a href>`/iframe it 401s under real auth. The fetch-based `rawContent` (line 197) is correct.

**Fix:** Ensure the UI fetches raw content via `rawContent()` (blob → object URL) rather than linking the bare URL. Remove or clearly mark `rawFileContentUrl` as dev-only.

**Files:** `apps/web/src/lib/api.ts`, any component referencing `rawFileContentUrl` (e.g. `RawParsedView.tsx`).

**Exit criterion:** Raw file viewing works under real Clerk auth (no 401).

---

### W4.3 — Resolve parser scope drift

**Severity:** Low (anti-drift bookkeeping)

**Root cause:** `packages/edi-parser` now interprets 860/875/880, beyond the documented v1 set (850/855/856/810/997/999) in `BUILD_PLAN.md` and `CLAUDE.md`.

**Fix:** Either record the decision to support the extra sets (update both docs and the "transaction sets in scope" list), or gate them behind a flag if they're not ready for v1. Apply the Section 1 anti-drift rule: one sentence on how each added set serves monitoring/troubleshooting/stability.

**Files:** `BUILD_PLAN.md`, `CLAUDE.md`.

**Exit criterion:** Docs and parser agree on the supported set list.

---

## Suggested sequencing

| Order | Items | Rationale |
|---|---|---|
| 1 | W1.1, W1.2 | Critical: block unauthenticated prod access and cross-tenant data loss. |
| 2 | W2.2, W2.3 | Get CI green so every subsequent fix is verified automatically. |
| 3 | W2.1 | Restore Phase 7 / M3 value for all tenants. |
| 4 | W3.3, W3.4 | Cheap, high-leverage hardening + hygiene. |
| 5 | W3.1, W3.2 | Architecture decisions (ADR-worthy); schedule deliberately. |
| 6 | W4.x | Polish once the above is stable. |

## Definition of done for this plan

- `npm run typecheck`, `npm run lint`, and `npm test` all pass locally and in CI.
- A production-config boot with missing Clerk secrets fails fast (W1.1).
- Cross-tenant ISA control-number ingestion is proven by test (W1.2).
- Detection emits alerts for more than one tenant (W2.1).
- `CLAUDE.md` / `BUILD_PLAN.md` describe the system as actually built (W3.1, W4.3).
- `SECURITY_CHECKLIST.md` updated for any item these changes touch (per the repo's own rule).
