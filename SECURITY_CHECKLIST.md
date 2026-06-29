# Security checklist (sign-off)

**Purpose:** Sign-off for **M4 (Sellable)** and pre-launch verification. Items are code-enforced or test-verified unless marked **operator action**.

**Last updated:** 2026-06-25 · Re-review with security advisor before first paid contract.

**Related:** [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) (findings + remediation) · [`BUILD_PLAN.md` §4](BUILD_PLAN.md#4-deploy-track--go-live-gate-deferred) (operator drills) · [`AGENTS.md`](AGENTS.md) §8

---

## Authentication

| # | Item | Status | Evidence |
|---|---|---|---|
| 1.1 | JWT required except public probes + webhooks (see below) | ✅ | `apps/api/src/plugins/tenant.ts` `PUBLIC_ROUTES` |
| 1.1a | Public: `GET /health` — minimal liveness (`{ status: 'ok' }` only) | ✅ | `routes/health.ts` (SEC-4) |
| 1.1b | Public: `GET /readiness` — ALB target group; exposes dep + channel detail | ✅ | `routes/internal.ts` |
| 1.1c | Public: `GET /internal/metrics` — app allowlist; **403 at ALB** from internet | ✅ | `infra/alb.tf` listener rule (SEC-3) |
| 1.1d | Public: `POST /webhooks/clerk` — Svix signature, not JWT | ✅ | `routes/webhooks.ts` |
| 1.2 | Clerk SDK verification | ✅ | `apps/api/src/services/auth.ts` |
| 1.3 | Forged tokens → 401 | ✅ | `apps/api/test/isolation.test.ts` |
| 1.4 | Webhook Svix signature | ✅ | `apps/api/src/routes/webhooks.ts` |
| 1.5 | No dev-fallback in production | ✅ | `production-auth.test.ts`, `config.ts` |

---

## Tenant isolation

| # | Item | Status | Evidence |
|---|---|---|---|
| 2.1 | `tenantId NOT NULL` on all multi-tenant models | ✅ | `schema.prisma` |
| 2.2 | Prisma extension filters every query | ✅ | `tenant-extension.ts` |
| 2.3 | Schema drift test for new models | ✅ | `tenant-extension.test.ts` |
| 2.4–2.6 | Cross-tenant 404; audit scoped | ✅ | `isolation.test.ts` |
| 2.7 | `bypass()` only for admin/webhook paths | ✅ | grep `tenantContext.bypass` |
| 2.8 | `requireTenantId()` throws in production | ✅ | `tenant-context.test.ts` |

---

## RBAC

| # | Item | Status | Evidence |
|---|---|---|---|
| 3.1 | Every route has `requiredRole` | ✅ | `route-role-matrix.test.ts` |
| 3.2–3.4 | Hierarchy, 403, self-demotion guard | ✅ | `auth.test.ts`, `users.ts` |

---

## Audit logging

| # | Item | Status | Evidence |
|---|---|---|---|
| 4.1–4.4 | Mutations audited atomically; admin-only list | ✅ | `audit.test.ts`, `audit.ts` |

---

## Encryption in transit / at rest

| # | Item | Status | Evidence |
|---|---|---|---|
| 5.1–5.5 | TLS 1.3, HSTS, RDS SSL, S3 TLS-only | ✅ | `infra/alb.tf`, `rds.tf`, `s3.tf` |
| 6.1–6.4 | RDS/S3/Secrets KMS encryption | ✅ | Terraform + `storage/s3.ts` |

---

## Secrets, logging, headers, network

| # | Item | Status | Evidence |
|---|---|---|---|
| 7.1–7.3 | Secrets Manager in prod; `.env` in dev | ✅ | `secrets.ts` |
| 7.4 | ECS task KMS decrypt | ⚠️ Operator | `infra/secrets.tf` output |
| 8.1–8.2 | Structured logs, no PII default | ✅ | `server.ts` |
| 8.3 | Rate limiting | ✅ | `rate-limit.test.ts`; staging: `ops/load/k6/abuse-rate-limit.js` |
| 8.3a | Per-task buckets (N× limit behind ALB) | ⚠️ Documented | `rate-limit.ts`; Redis/WAF at scale → [`BUILD_PLAN.md` §5](BUILD_PLAN.md#5-future--optional-features) |
| 8.3b | `trustProxy: true` — client IP from ALB | ✅ | `server.ts`; ECS SG ingress ALB-only (`ecs.tf`) |
| 9.1–9.3 | Security headers; ALB header scrub | ✅ | `security-headers.test.ts` |
| 10.1–10.3 | Private RDS; SG ingress; S3 block public | ✅ | `infra/rds.tf`, `s3.tf` |

---

## Sign-off

- [x] Item-by-item review complete
- [x] All ✅ have code/test reference
- [ ] Independent reviewer second-pass (recommended before first paid contract)

Deferred security items → [`BUILD_PLAN.md` §5](BUILD_PLAN.md#5-future--optional-features).
