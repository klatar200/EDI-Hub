# EDI Data Hub — Phase 9 Security Checklist

**Purpose.** Sign-off artifact for the Phase 9 exit gate (M4 — Sellable
boundary). Every item here is either enforced in code (link to file +
line) or verified by an automated test (link to test file). Items marked
"Operator action" require a human-performed step at deploy time and are
not enforceable in code.

**Reviewed by:** Keagan (self-review). Re-review with a security-savvy
advisor recommended before signing the first external contract.

**Last updated:** 2026-06-21

---

## 1. Authentication

| # | Item | Status | Evidence |
|---|---|---|---|
| 1.1 | Every API route requires a verified Clerk JWT except `/health` and `/webhooks/clerk` | ✅ | `apps/api/src/plugins/tenant.ts` — `PUBLIC_ROUTES = Set(['/health', '/webhooks/clerk'])`; everything else passes through `verifyBearerToken`. |
| 1.2 | Token verification uses Clerk's SDK (signature + expiry + issuer check) | ✅ | `apps/api/src/services/auth.ts` — `authenticateRequest({ secretKey })`. |
| 1.3 | Forged / unverifiable tokens are rejected with 401 (not 200, not 500) | ✅ | `apps/api/test/isolation.test.ts` — "forged-claim probe…rejected with 401". |
| 1.4 | `/webhooks/clerk` verifies its Svix signature inline before processing | ✅ | `apps/api/src/routes/webhooks.ts`. |
| 1.5 | Dev-fallback (Clerk not configured) pins to pilot tenant and grants implicit admin — never enabled in production | ✅ | `apps/api/src/plugins/tenant.ts` returns 500 `AUTH_MISCONFIGURED` when `nodeEnv=production`; `assertProductionAuthConfig()` in `apps/api/src/config.ts` + `apps/api/src/index.ts`; `apps/api/test/production-auth.test.ts`. |

## 2. Tenant isolation

| # | Item | Status | Evidence |
|---|---|---|---|
| 2.1 | Every multi-tenant table carries `tenantId NOT NULL` | ✅ | `packages/db/prisma/schema.prisma` — every multi-tenant model. |
| 2.2 | Every query is filtered by the active tenant context (Prisma extension) | ✅ | `packages/db/src/tenant-extension.ts`. |
| 2.3 | Schema drift — any new model must be classified as tenant-scoped or exempt | ✅ | `packages/db/test/tenant-extension.test.ts` — "every model in schema.prisma is either tenant-scoped or exempt". |
| 2.4 | Cross-tenant id lookup returns 404 (not 403 — no existence leak) | ✅ | `apps/api/test/isolation.test.ts` — "tenant A asking for tenant B's partner by id returns 404". |
| 2.5 | Cross-tenant PATCH and DELETE return 404 and the foreign row survives | ✅ | `apps/api/test/isolation.test.ts` — "cross-tenant PATCH and DELETE both return 404". |
| 2.6 | Audit log is tenant-scoped | ✅ | `apps/api/test/isolation.test.ts` — "GET /audit returns only the calling tenant's rows". |
| 2.7 | `tenantContext.bypass()` is only used by audit-log writes + admin bootstrap, with explicit comments | ✅ | Search for `tenantContext.bypass` — appears only in `apps/api/src/plugins/tenant.ts` (tenant + user lookups) and tests. |

## 3. RBAC

| # | Item | Status | Evidence |
|---|---|---|---|
| 3.1 | Every authenticated route declares a `requiredRole` (or is explicitly ungated) | ✅ | `apps/api/test/route-role-matrix.test.ts` — exhaustive route × role assertion. |
| 3.2 | Role hierarchy enforced: admin > ops > viewer | ✅ | `apps/api/src/plugins/tenant.ts` — `ROLE_RANK`. |
| 3.3 | Below-role caller receives 403 FORBIDDEN | ✅ | `apps/api/test/auth.test.ts` — viewer/ops/admin matrix. |
| 3.4 | Admin cannot demote / delete themselves (tenant-orphan guard) | ✅ | `apps/api/src/routes/users.ts` — `CANNOT_DEMOTE_SELF`, `CANNOT_DELETE_SELF`. |

## 4. Audit logging

| # | Item | Status | Evidence |
|---|---|---|---|
| 4.1 | Every data-mutating route writes an audit row | ✅ | `apps/api/test/audit.test.ts` — POST/PATCH/DELETE on partners + ack/snooze on alerts + role-change on users. |
| 4.2 | Audit insert lives in the same `$transaction` as the data write (atomic) | ✅ | `apps/api/src/services/audit.ts` — `withAudit()`; `apps/api/test/audit.test.ts` — "failed audit insert surfaces as a 500". |
| 4.3 | Audit row carries actor, action verb, target type/id, and before/after diff | ✅ | `apps/api/src/services/audit.ts` — `EmitAuditInput`. |
| 4.4 | Audit list is admin-only | ✅ | `apps/api/src/routes/audit.ts` — `requiresRole('admin')`. |

## 5. Encryption — in transit

| # | Item | Status | Evidence |
|---|---|---|---|
| 5.1 | Public clients reach the API only over TLS 1.3 | ✅ | `infra/alb.tf` — `ssl_policy = ELBSecurityPolicy-TLS13-1-2-2021-06`. |
| 5.2 | HTTP:80 → HTTPS:443 redirect on the ALB | ✅ | `infra/alb.tf` — `aws_lb_listener.http_redirect`. |
| 5.3 | `Strict-Transport-Security` header on every response (180-day max-age + includeSubDomains) | ✅ | `apps/api/src/plugins/security-headers.ts`; tested by `apps/api/test/security-headers.test.ts`. |
| 5.4 | API → Postgres requires SSL (`rds.force_ssl=1`) | ✅ | `infra/rds.tf` — `aws_db_parameter_group.edi.parameter`. |
| 5.5 | S3 bucket policy denies any non-TLS request | ✅ | `infra/s3.tf` — `DenyInsecureTransport` statement. |

## 6. Encryption — at rest

| # | Item | Status | Evidence |
|---|---|---|---|
| 6.1 | RDS storage encrypted (KMS-managed) | ✅ | `infra/rds.tf` — `storage_encrypted = true`. |
| 6.2 | RDS backups inherit encryption (same KMS key) | ✅ | `infra/rds.tf` — backups inherit source storage's key by default. |
| 6.3 | S3 SSE-S3 enforced on every PUT (default rule + bucket policy + SDK header) | ✅ | `infra/s3.tf` — `DenyUnencryptedPut`; `apps/api/src/storage/s3.ts` — `ServerSideEncryption: 'AES256'` on every Upload. |
| 6.4 | Secrets Manager entries encrypted with a project-owned CMK (rotation enabled) | ✅ | `infra/secrets.tf` — `aws_kms_key.secrets` + `kms_key_id` on each secret. |

## 7. Secrets handling

| # | Item | Status | Evidence |
|---|---|---|---|
| 7.1 | Production reads secrets from AWS Secrets Manager (DB URL, Clerk keys, Slack webhook) | ✅ | `apps/api/src/services/secrets.ts` — `applySecretsFromManager()`; selected by `SM_PREFIX`. |
| 7.2 | Dev reads from `.env`; switching is one env var | ✅ | `apps/api/src/services/secrets.ts` — `defaultSecretSource()`. |
| 7.3 | No secret material in git or Terraform state (variables marked `sensitive`) | ✅ | `infra/rds.tf` — `db_master_password` sensitive; values supplied via `TF_VAR_*` env vars. |
| 7.4 | The ECS task role grants `kms:Decrypt` only on the project CMK | ⚠️ Operator action | Documented in `infra/secrets.tf` — `secrets_kms_key_arn` output is the only ARN to grant; the task-role module is part of a later phase. |

## 8. Logging & observability

| # | Item | Status | Evidence |
|---|---|---|---|
| 8.1 | No PII or partner data in stdout logs by default (Fastify pino at `info`) | ✅ | `apps/api/src/server.ts` — `logger: { level: ... }`; ingest + parsing log file ids only. |
| 8.2 | Errors logged with structured context (not raw exception strings) | ✅ | Spot-checked across services — every `logger.error` passes an object literal. |
| 8.3 | Rate limiting documented for Phase 10 | ⚠️ Deferred | `BUILD_PLAN.md` Phase 10 — rate limiting + load testing. |

## 9. Defensive headers

| # | Item | Status | Evidence |
|---|---|---|---|
| 9.1 | `X-Content-Type-Options: nosniff` on every response | ✅ | `apps/api/src/plugins/security-headers.ts`; tested by `apps/api/test/security-headers.test.ts`. |
| 9.2 | `Referrer-Policy: no-referrer` on every response | ✅ | Same. |
| 9.3 | ALB drops invalid header fields | ✅ | `infra/alb.tf` — `drop_invalid_header_fields = true`. |

## 10. Network exposure

| # | Item | Status | Evidence |
|---|---|---|---|
| 10.1 | RDS is in private subnets, no public endpoint | ✅ | `infra/rds.tf` — `publicly_accessible = false`. |
| 10.2 | Only the API task security group can reach Postgres on 5432 | ✅ | `infra/rds.tf` — `aws_security_group_rule.db_ingress_app` for_each over allowed SGs. |
| 10.3 | S3 bucket blocks every public-access avenue | ✅ | `infra/s3.tf` — `aws_s3_bucket_public_access_block` with all four toggles `true`. |

---

## Items intentionally deferred

- **Per-tenant KMS keys (BYOK).** Phase 11+ enterprise tier.
- **Postgres row-level security policies.** Duplicates the Prisma extension; the Sprint 6 isolation tests + DMMF drift check are the chosen posture.
- **Audit log streamed to CloudWatch / S3.** Same Postgres for v1 (BUILD_PLAN Open Q #2).
- **WAF rules on the ALB.** Revisit if abuse appears post-launch.
- **Rate limiting.** Phase 10.
- **SOC 2 / external pen test.** Triggered when the first regulated buyer asks.

---

## Sign-off

- [x] Item-by-item review complete
- [x] All ✅ items have a code or test reference; all ⚠️ items have a documented operator action or deferral
- [ ] Independent reviewer second-pass (recommended before first paid external contract)

Phase 9 exit gate: **Sellable boundary reached.**
