# Security audit — EDI Data Hub (API + web)

**Date:** 2026-06-27  
**Scope:** `apps/api`, `apps/web`, `packages/db` tenant extension  
**Mode:** Local-first / pre-go-live — findings include SaaS, desktop LAN, and infra assumptions  
**Status:** SEC-1 remediation **shipped** (2026-06-27) · SEC-2 **shipped** (2026-06-28) · SEC-3 pending

**Related:** [`BUILD_PLAN.md`](../BUILD_PLAN.md) §12 · [`SECURITY_CHECKLIST.md`](../SECURITY_CHECKLIST.md) (redirect stub)

---

## Executive summary

The codebase has a **strong security foundation** for cloud SaaS: Clerk JWT verification, per-route RBAC (enforced by `route-role-matrix.test.ts`), Prisma tenant extension with adversarial isolation tests, Svix webhook verification, rate limiting, security headers, and audit logging on mutations.

**Gaps cluster in three areas:**

1. **Desktop LAN SKU** — production desktop without Clerk = unauthenticated implicit admin on the network (**Critical**).
2. **Web client tenant switching** — React Query cache not cleared on org change can show stale cross-tenant data (**High**).
3. **Operational / defense-in-depth** — soft-deleted tenants still authenticate, public metrics/readiness, error message leakage (**High/Medium**).

**Estimated remediation:** 3 focused sprints (see [Remediation plan](#remediation-plan)). Not a rewrite — mostly targeted fixes + tests.

---

## What is already well protected

| Control | Evidence |
|---------|----------|
| Every `/api/*` route declares `requiredRole` | `apps/api/test/route-role-matrix.test.ts` |
| Production SaaS refuses boot without Clerk | `config.ts` `assertProductionAuthConfig`; `production-auth.test.ts` |
| Cross-tenant data → 404 (not 403) | `isolation.test.ts` |
| Forged JWT → 401 | `auth.test.ts`, `isolation.test.ts` |
| Webhook Svix verification | `routes/webhooks.ts`; dormant when secret unset |
| Rate limits (429 + Retry-After) | `rate-limit.test.ts` |
| Security headers (HSTS, nosniff) | `security-headers.test.ts` |
| Mutations → audit row (atomic) | `audit.test.ts` |
| Tenant extension + schema drift test | `packages/db/test/tenant-extension.test.ts` |
| Upload size limits + ops role | `routes/ingest.ts` |
| No `dangerouslySetInnerHTML` in web | grep clean in `apps/web/src` |
| Bearer tokens (not cookies) — no CSRF on API | `apps/web/src/lib/api.ts` |

---

## Findings

### Critical

#### SEC-C1 — Desktop hub: unauthenticated LAN admin

| | |
|---|---|
| **Where** | `apps/api/src/plugins/tenant.ts` (dev-fallback), `config.ts` (desktop exempt from production Clerk guard) |
| **Issue** | When `CLERK_SECRET_KEY` is empty and `EDI_HUB_USER_DATA_DIR` is set (desktop LAN), API listens on `0.0.0.0` with **dev-fallback**: pilot tenant + **RBAC skipped** (`request.auth === null`). Any device on the LAN can call admin routes without a token. |
| **Impact** | Full data read/write, partner config, user management, ingest on a network-exposed install. |
| **Fix** | Require Clerk keys or a **local API token** for desktop production; never skip RBAC when `NODE_ENV=production`. Optional: bind to LAN IP only + firewall docs. |
| **Tests** | Extend `production-auth.test.ts`; desktop integration test with token required. |

---

### High

#### SEC-H1 — Soft-deleted tenants can still use the API

| | |
|---|---|
| **Where** | `apps/api/src/plugins/tenant.ts` — `tenant.findUnique({ clerkOrgId })` without `deletedAt: null` |
| **Issue** | `DELETE /api/tenants/me` sets `deletedAt`; retention hard-deletes after 30 days. Until then, valid Clerk JWTs still work. |
| **Fix** | Reject tenants with `deletedAt !== null` → `403 TENANT_SUSPENDED`. |
| **Tests** | Add case to `isolation.test.ts` or tenant plugin test. |

#### SEC-H2 — Web: cross-tenant cache on org switch

| | |
|---|---|
| **Where** | `apps/web/src/main.tsx` (QueryClient), `Layout.tsx` (`OrganizationSwitcher`), all `useQuery` keys |
| **Issue** | Query keys omit `organization.id`. Switching Clerk org navigates to `/` but **does not invalidate cache**. Previous tenant's lifecycles/transactions can remain visible until staleTime/refetch. |
| **Fix** | On org change: `queryClient.clear()` or tenant-scoped keys (`['lifecycles', orgId]`). Subscribe to `useOrganization()` and reset when `id` changes. |
| **Tests** | Vitest or Playwright: switch org → assert old PO numbers not shown. |

#### SEC-H3 — Passive ingestion pinned to pilot tenant

| | |
|---|---|
| **Where** | `apps/api/src/channels/drop-folder.ts` |
| **Issue** | SFTP/AS2/desktop-drop ingest under `PILOT_TENANT_ID` always. Multi-tenant SaaS with these channels enabled misattributes all passive files. |
| **Fix** | Disable passive channels when `NODE_ENV=production` and multi-tenant until per-tenant channel mapping exists; document operator constraint. |
| **Tests** | Config guard test. |

#### SEC-H4 — `/internal/metrics` and `/readiness` unauthenticated

| | |
|---|---|
| **Where** | `plugins/tenant.ts` `PUBLIC_ROUTES`, `routes/internal.ts` |
| **Issue** | By design for ALB/Prometheus. Exposes DB/S3/channel health if reachable from internet. |
| **Fix** | **Go-live only:** ALB SG blocks public access; optional scrape token header. Update §12 checklist. |
| **Tests** | Document in `infra/`; optional integration test behind env flag. |

#### SEC-H5 — RBAC bypass when `request.auth` is null

| | |
|---|---|
| **Where** | `tenant.ts` preHandler — role check only if `request.auth` truthy |
| **Issue** | Same root as SEC-C1; any future path that sets `tenantId` without `auth` skips RBAC. |
| **Fix** | Fail closed: if `requiredRole` and `!request.auth` and not explicit dev-only → 401/500. |

---

### Medium

| ID | Issue | Where | Fix |
|----|-------|-------|-----|
| SEC-M1 | Auth errors leak Clerk `reason` to client | `tenant.ts`, `auth.ts` | Generic client message; log detail server-side |
| SEC-M2 | 403 reveals caller's role | `tenant.ts` | Generic FORBIDDEN |
| SEC-M3 | `/health` leaks channel paths + LAN IPs | `health.ts`, `server-address.ts` | Minimal public health; detail behind auth |
| SEC-M4 | Per-task rate limits (not shared) | `rate-limit.ts` | Document; Redis or ALB WAF at go-live |
| SEC-M5 | `trustProxy` + direct task access | `server.ts` | ECS SG ingress ALB-only (go-live) |
| SEC-M6 | Upload buffers full file in memory | `ingest.ts` | Stream to S3; cap concurrent uploads |
| SEC-M7 | `$queryRawUnsafe` in lifecycle list | `lifecycles.ts` | Migrate to `Prisma.sql`; add injection test |
| SEC-M8 | `POST /api/setup/verify-auth` doesn't verify Clerk | `routes/setup.ts` | Real verification or remove bypass |
| SEC-W1 | Token getter race on first paint | `AuthBridge.tsx` | Gate `MeProvider` until token ready |
| SEC-W2 | `VITE_API_URL` can point JWTs elsewhere | `api.ts` | Allowlist `/api` in production builds |
| SEC-W3 | Admin routes lack client route guards | `App.tsx` | `RequireRole` on `/admin/audit`, partners editor |
| SEC-W4 | No CSP on static SPA | `index.html` / CDN | CSP headers at go-live |
| SEC-W5 | `@clerk/react: "latest"` | `package.json` | Pin semver |

---

### Low

| ID | Issue | Fix |
|----|-------|-----|
| SEC-L1 | No global 401 handler in web | Central fetch wrapper → sign out |
| SEC-L2 | Blob URLs not revoked | `URL.revokeObjectURL` |
| SEC-L3 | Download filenames from user input | Sanitize `a.download` |
| SEC-L4 | Dead `rawFileContentUrl` without auth | Remove or document |
| SEC-L5 | `.env.example` has realistic-looking Clerk keys | Replace with `REPLACE_ME` placeholders |

---

## Remediation plan

Work in order. Each sprint ends with `npm run test:ci` green and targeted security tests.

### Sprint SEC-1 — Block real vulnerabilities (API + web)

**Goal:** Close Critical + highest-impact High items.

| Task | Finding | Effort |
|------|---------|--------|
| Desktop LAN auth hardening | SEC-C1, SEC-H5 | Medium — design: API key in `clerk-runtime.json` or require Clerk for desktop prod |
| Block deleted tenants at auth | SEC-H1 | Small |
| Org-switch cache invalidation | SEC-H2 | Small |
| AuthBridge token-ready gate | SEC-W1 | Small |
| Sanitize `.env.example` | SEC-L5 | Trivial |

**Exit:** Desktop without Clerk cannot serve admin routes on LAN; org switch cannot show stale tenant data; tests added.

---

### Sprint SEC-2 — Defense in depth

**Goal:** Reduce leakage and client-side gaps.

| Task | Finding | Effort |
|------|---------|--------|
| Generic auth/RBAC error messages | SEC-M1, SEC-M2 | Small |
| Admin route guards in web | SEC-W3 | Small |
| `RequireRole` on partners mutation UI | SEC-W3 | Small |
| Tenant-scoped React Query keys | SEC-H2 (hardening) | Small |
| Pin `@clerk/react` | SEC-W5 | Trivial |
| `setup/verify-auth` real check or remove | SEC-M8 | Small |
| Passive channel multi-tenant guard | SEC-H3 | Small |

**Exit:** No role/token leakage in 403/401 bodies; admin URLs guarded in UI.

---

### Sprint SEC-3 — Go-live hardening (defer until AWS deploy)

**Goal:** Items that matter when staging/production exists.

| Task | Finding |
|------|---------|
| ALB SG: block `/internal/*` from internet | SEC-H3, SEC-H4 |
| Minimal `/health` for public probes | SEC-M3 |
| CSP for static assets | SEC-W4 |
| `VITE_API_URL` production allowlist | SEC-W2 |
| Shared rate limit or WAF | SEC-M4, SEC-M5 |
| Prisma.sql migration for lifecycles | SEC-M7 |
| Update BUILD_PLAN §12 public route list | SEC-M8 doc |
| k6 abuse test + rate-limit audit row | BUILD_PLAN §10 |

**Exit:** Staging smoke + security checklist §12 re-sign-off.

---

## Local development vs go-live

| Finding | Action now (local $0) | Defer to go-live |
|---------|----------------------|------------------|
| SEC-C1 Desktop LAN | Fix if you ship desktop to customers; optional if you only use SaaS local dev | Required before desktop LAN sales |
| SEC-H2 Org cache | **Fix now** — affects Clerk dev testing | — |
| SEC-H1 Deleted tenant | **Fix now** — small, correct semantics | — |
| SEC-H3 Passive channels | Document; keep SFTP off in `.env` | Multi-tenant SaaS deploy |
| SEC-H4 Metrics public | Ignore locally | ALB + SG at deploy |
| SEC-M4–M5 Rate limit scale | Ignore single dev task | ECS multi-task |
| SEC-W4 CSP | Optional locally | Required for production |

---

## How to run this audit again

```powershell
npm run test:ci
npm run test --workspace=@edi/api -- --test-name-pattern "isolation|auth|rate-limit|production-auth|route-role"
npm run test --workspace=@edi/web
```

Manual checks (local):

- Sign in → switch org → confirm lifecycle list refreshes
- Hit `/api/admin/audit` as viewer → 403
- Cross-tenant UUID in URL → 404

---

## Next step

Start **Sprint SEC-3** when preparing go-live (ALB SG, CSP, minimal `/health`, Prisma.sql migration).
