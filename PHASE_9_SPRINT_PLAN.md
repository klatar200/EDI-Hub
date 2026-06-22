# Phase 9 — Multi-Tenancy, Auth & Security Hardening: Sprint Plan

**Phase goal:** Convert a validated single-company tool into a secure product
that can be sold. Before Phase 9 you have your employer's internal tool;
after Phase 9 you have something safe to put in another company's hands.

**Exit criteria (= BUILD_PLAN Phase 9 exit):**
- Two fully isolated tenants operate with zero data bleed (independently
  verified — see Sprint 6).
- RBAC enforced on every authenticated route (admin / ops / viewer).
- Authentication via Clerk; no unauthenticated access to data.
- Encryption in transit (TLS termination at the LB) and at rest (RDS + S3).
- Per-tenant audit logging on data-touching writes.
- Documented security review checklist passed.

**Estimated effort:** 4–6 weeks at 15–25 hrs/week. BUILD_PLAN flags this as
the largest, least-Opus-compressible phase — much of the work is verification
and judgment, not code volume. Plan around your review/test bandwidth.

**Milestone reached:** M4 — Sellable boundary.

**Builds on:**
- Phase 6 partner config (`tenantId` column was already added as nullable on
  `trading_partners` and the comments anticipated this phase).
- Phase 7 alerts (the audit log uses the same idempotency + dedupe patterns).
- Phase 8 channels (channel boot is per-process today; multi-tenancy doesn't
  change that — channels remain operator-scoped, not per-tenant).

---

## Locked decision gates (from session intake)

| Gate | Decision | Why |
|---|---|---|
| **A — Tenant isolation** | Row-level `tenant_id` on every multi-tenant table, enforced via a Prisma extension/middleware. | Lowest operational overhead; the standard SaaS default. Isolation is a code invariant, so Sprint 6 is dedicated to verifying it. |
| **B — Auth provider** | Clerk. | Already listed in CLAUDE.md; hosted UI + JWT minimizes work in this phase. |
| **C — RBAC roles** | `admin` / `ops` / `viewer`. | Three roles cover the realistic personas (admin manages users + config, ops works alerts + acks, viewer is read-only). |
| **D — Secrets handling** | AWS Secrets Manager in prod; `.env` in dev. Loader abstraction so call sites don't care. | Defer Vault / KMS-direct work; Secrets Manager is the AWS-native default and integrates with ECS task IAM. |

---

## What changes vs. Phase 8

| Layer | Today (Phase 8) | Phase 9 adds |
|---|---|---|
| **Tenancy** | Single implicit tenant — `tenantId` is a nullable column nobody filters on. | First-class `Tenant` table; every multi-tenant row carries `tenantId`; every query is filtered through a Prisma extension so it's impossible to write a leaky route. |
| **Auth** | None — the API is open. | Clerk JWT required on every route except `/health`. JWT claims carry `userId` + `tenantId` + `role`; a Fastify `preHandler` hook sets `request.auth` from the verified token. |
| **RBAC** | None. | `admin` / `ops` / `viewer` enum on `User`. Routes declare a `requiredRole` and the `preHandler` enforces it. UI hides what the role can't do. |
| **Secrets** | `.env` for everything (DB URL, S3 creds, SES, Slack webhooks). | Production reads from AWS Secrets Manager; dev still reads `.env`. `loadConfig` becomes async with a pluggable secret source. |
| **Audit log** | None. | New `AuditEvent` table. Every write (partner CRUD, alert ack/snooze, user CRUD) emits a row with `tenantId`, `actorId`, `action`, `targetType`, `targetId`, `payloadDiff`. |
| **Encryption** | Local MinIO + Postgres on docker-compose. | RDS at-rest enabled by default; S3 SSE-S3 enforced via bucket policy; ALB → API is TLS via ACM cert. |
| **OUR_ISA_IDS** | Single global list from env. | Per-tenant list stored on `Tenant`. Parser direction resolution becomes tenant-scoped. |

---

## Pre-sprint architecture decisions

These are smaller than Gates A–D but worth committing to up front.

| Question | Decision | Reason |
|---|---|---|
| Tenant resolution from a JWT | Clerk JWT claims include `org_id`; we map `org_id` → `tenantId` once at sign-in. | Treat Clerk Organizations as the source of tenancy. Cheaper than reimplementing org membership. |
| How does an admin bootstrap a new tenant? | Self-serve sign-up creates a Clerk Org → webhook creates a `Tenant` row + initial admin `User`. | Standard SaaS flow; works the same in dev (Clerk dev env) and prod. |
| What happens to existing data? | Backfill: every existing row gets the pilot's `tenantId`. The migration is a one-shot SQL `UPDATE`. | The single existing tenant is unambiguous; no risk of misattribution. |
| Tests against the multi-tenant DB shape | Every existing service test seeds its fake Prisma with a fixed `tenantId`. The Prisma extension is bypassable in tests via a `bypassTenancy` flag (used only by audit-log + admin operations). | Keep test churn manageable; the extension is the runtime guarantee, not the test guarantee. |
| Audit log retention | 365 days, soft-deleted at 730 days. | Industry-standard; cheap to extend later. |

---

## Sprint plan

> Effort estimates assume 15–25 hrs/week solo with Opus 4.8. Sprint 1 + 2 are
> compressible by Opus (mechanical schema changes + middleware); Sprints 3–6
> are progressively less compressible (judgment-heavy verification work).

### Sprint 1 — Tenant model + Prisma extension (Week 1)

**Goal:** Every multi-tenant row carries a `tenantId`. Every query is
filtered by it through a Prisma extension. Tests verify a query made in
tenant A's context cannot see tenant B's rows.

**Tasks:**
- **1.1 — Schema.** New `Tenant` table. `tenantId UUID NOT NULL` on every
  multi-tenant table (`raw_files`, `interchanges`, `functional_groups`,
  `transactions`, `segments`, `elements`, `alerts`, `trading_partners`,
  `audit_events`). Index on `(tenantId, createdAt)` where ordering matters.
  Backfill migration sets every existing row to the pilot's `tenantId`.
- **1.2 — Prisma extension.** A client extension that wraps every query with
  a `tenantId` filter sourced from an async-local-storage context. Writes
  inject `tenantId` automatically; reads filter automatically. A
  `bypassTenancy` escape hatch exists for audit-log writes and admin
  bootstrap, used only via an explicit helper.
- **1.3 — Tenant context.** `tenantContext.run(tenantId, fn)` AsyncLocalStorage
  wrapper. Set once per request by the auth `preHandler` (Sprint 2). For now,
  background jobs and scripts take an explicit `tenantId` argument.
- **1.4 — Move OUR_ISA_IDS to the Tenant row.** Parser direction resolution
  reads from the tenant record rather than the env var.
- **1.5 — Tests.** Two-tenant isolation tests on every read path. Sprint 1
  exit gate: a test in tenant A's context that queries everything must return
  zero of tenant B's rows.

**Acceptance:** All existing tests pass after fixtures are tenant-aware.
Two-tenant isolation tests pass. The pilot's data is still visible (backfill
worked).

**Effort:** 1–2 weeks.

---

### Sprint 2 — Clerk auth + JWT verification + tenant resolution (Week 2)

**Goal:** Every API route requires a verified Clerk JWT. The JWT's `org_id`
maps to a `tenantId` which the request handler can consume via the Sprint 1
context. The web app uses Clerk's React components for sign-in.

**Tasks:**
- **2.1 — Clerk setup.** New `@clerk/fastify` (or manual JWT verify against
  Clerk's JWKS) on the API. New `@clerk/clerk-react` on the web. Sign-up
  flow creates a Clerk Organization.
- **2.2 — Tenant resolution.** Clerk webhook (`organization.created`) creates
  a `Tenant` row and a `User` row for the initial admin. A second webhook
  (`user.added_to_organization`) creates additional `User` rows. Webhook
  signatures verified.
- **2.3 — Fastify auth preHandler.** Verifies the JWT, looks up the `User`
  row by Clerk user id + org id, sets `request.auth = { userId, tenantId, role }`,
  and starts the tenant context.
- **2.4 — Web auth shell.** Sign-in page wraps the app; protected routes
  require a session. Active org chooser when the user belongs to multiple.
- **2.5 — `/health` stays public.** Single allowlist; everything else requires auth.
- **2.6 — Tests.** Unauthenticated requests get 401; cross-tenant requests
  (valid JWT for tenant A, asking for tenant B's data) get a clean 404 (not 403 — we don't leak existence).

**Acceptance:** A new dev signup creates a fresh tenant; the existing pilot
admin keeps access via their Clerk identity. Unauthenticated `curl` of any
data route returns 401.

**Effort:** 1–1.5 weeks.

---

### Sprint 3 — RBAC: roles + route enforcement + UI hiding (Week 2-3)

**Goal:** Every route declares a required role; the preHandler enforces it.
The web hides actions the current role can't take.

**Tasks:**
- **3.1 — User.role enum.** `admin` / `ops` / `viewer`. Initial-admin role
  comes from the Clerk webhook; subsequent users default to `viewer` and
  admins promote them.
- **3.2 — Route declarations.** Add a `requiredRole` route option;
  Fastify `preHandler` checks it. Defaults:
  - `viewer`: every GET.
  - `ops`: alert ack/snooze, transaction reparse, ack-related actions.
  - `admin`: partners-config CRUD, user CRUD, tenant settings.
- **3.3 — User management.** New `GET/POST/PATCH/DELETE /users`
  endpoints, admin-only. Admins assign roles within their own tenant.
- **3.4 — Web role gating.** A `useRole()` hook + `<RequireRole role>` wrapper
  on actionable buttons. Pages still render so a viewer can see structure;
  only mutating affordances disappear.
- **3.5 — Tests.** Per route: 200 for the right role, 403 for a role below
  it, 404 for cross-tenant. Web component tests confirm role gating.

**Acceptance:** A `viewer` cannot acknowledge an alert via the API or the UI.
An `ops` cannot create a partner. An `admin` can do everything within their
tenant. Nobody can touch another tenant.

**Effort:** ~1 week.

---

### Sprint 4 — Audit log + secrets manager (Week 3-4)

**Goal:** Every data-touching write emits an audit row. Production reads
secrets from AWS Secrets Manager; dev still uses `.env`. The loader is
async and pluggable.

**Tasks:**
- **4.1 — `AuditEvent` table.** `id, tenantId, actorId, action,
  targetType, targetId, payloadDiff JSONB, createdAt`. Indexed on
  `(tenantId, createdAt)`.
- **4.2 — Audit emit helper.** `audit(action, target, diff)` called from each
  write path. Failure to write the audit row fails the request (so audit
  coverage stays honest — silent audit gaps are worse than user-facing errors).
- **4.3 — Audit list route.** `GET /audit` (admin-only). Filters by
  `actorId`, `action`, date range.
- **4.4 — Secrets loader.** `loadConfig` becomes async. New `SecretSource`
  interface; `EnvSecretSource` for dev, `SecretsManagerSecretSource` for prod.
  Selected by `NODE_ENV` + an `SM_PREFIX` env override.
- **4.5 — Migration.** All current `.env`-only secrets get documented entries
  in Terraform so prod boot has them in Secrets Manager.
- **4.6 — Tests.** Audit row written on every PATCH/POST/DELETE in
  partners-config, alerts, users. Secret-loader tests cover both backends.

**Acceptance:** Every write the UI can do shows up in `/audit`. Production
boot reads DB URL + Clerk keys + S3 creds from Secrets Manager. Dev boot
is unchanged.

**Effort:** ~1 week.

---

### Sprint 5 — Encryption + Terraform hardening (Week 4-5)

**Goal:** RDS, S3, and the ALB-to-API hop are encrypted with regional-default
keys. Terraform changes are reviewed by you before apply.

**Tasks:**
- **5.1 — RDS encryption at rest.** Terraform: `storage_encrypted = true`
  with the AWS-managed key. New RDS instance is encrypted by default; the
  existing one needs a snapshot-restore migration.
- **5.2 — S3 SSE.** Bucket policy enforces SSE-S3 on every PUT. Existing
  objects re-encrypted via a one-shot `aws s3 cp --sse` over the prefix.
- **5.3 — TLS.** ACM cert on the ALB; HTTPS listener; HTTP → HTTPS redirect.
  Strict-Transport-Security header on all API responses.
- **5.4 — Secrets in Terraform.** `aws_secretsmanager_secret` for each
  config slot. The ECS task IAM role can read only its tenant's secrets
  (eventually — for now, all secrets are operator-scoped).
- **5.5 — Tests / smoke.** Hit the staging API over plain HTTP and verify
  the redirect; verify a S3 PUT without SSE is rejected.

**Acceptance:** No plaintext path in or out of the system. Staging passes the
checks before prod runs the same Terraform.

**Effort:** ~1 week.

---

### Sprint 6 — Independent isolation verification + security checklist (Week 5-6)

**Goal:** Prove the multi-tenant isolation works under adversarial conditions.
Document the security review.

**Tasks:**
- **6.1 — Two-tenant fuzz.** Stand up two tenants in staging. Seed each with
  distinguishable data. Run a script that tries every API endpoint from each
  tenant's JWT and asserts the responses contain only that tenant's data.
- **6.2 — Direct DB inspection.** A test reads the raw `raw_files` /
  `transactions` tables (bypassing the Prisma extension) and confirms every
  row has the expected `tenantId`. Catches the case where a write path
  forgot to inject it.
- **6.3 — Cross-tenant probe.** Forge tenant A's JWT but rewrite the `org_id`
  claim to tenant B's id (signed with a different key). Confirm verification
  rejects it. Confirm a Clerk-signed JWT for tenant A can't access tenant B
  data even by sending tenant B's UUID in the URL.
- **6.4 — Role probe.** For every route, confirm the role enforcement
  matches the route declaration.
- **6.5 — Security review checklist.** Written checklist covering:
  - All routes authenticated except `/health`
  - All multi-tenant queries filtered
  - All writes audited
  - All transports encrypted
  - All secrets sourced from Secrets Manager in prod
  - No `console.log` of PII or partner data
  - Rate limiting documented (deferred to Phase 10)
  Reviewed by you and signed off in the ADR.
- **6.6 — Update CLAUDE.md.** Document tenant-aware patterns so future
  Claude sessions don't accidentally write leaky code.

**Acceptance (= Phase 9 exit):** Isolation independently verified; RBAC
enforced; security checklist passed. M4 — Sellable boundary — reached.

**Effort:** 1–1.5 weeks. *(Mostly testing + judgment — least compressible.)*

---

## Testing approach

- **Sprint 1:** Two-tenant fixture; every existing service test re-runs in
  both tenants and asserts no cross-bleed.
- **Sprint 2:** Auth integration tests use a stub JWT verifier seeded with
  known tenant/user/role triples.
- **Sprint 3:** Per-route role matrix; web tests confirm UI hiding.
- **Sprint 4:** Audit log presence after every write; secret-loader tests
  cover both sources.
- **Sprint 5:** Terraform `plan` review; staging smoke for TLS + SSE.
- **Sprint 6:** Adversarial isolation test suite, run separately from the
  unit/integration suite so it can be re-run pre-release.

---

## Explicitly out of scope

- **Vault / KMS direct integration** — Secrets Manager covers the SaaS use
  case; revisit only if a regulated-industry customer demands it.
- **Per-tenant encryption keys** — bring-your-own-key is a Phase 11+
  enterprise tier feature.
- **Custom SSO (SAML/OIDC) beyond Clerk's defaults** — Clerk's enterprise
  tier covers this when needed.
- **Row-level Postgres RLS policies** — duplicates the Prisma extension and
  adds operational complexity. The application-layer guarantee plus Sprint 6
  verification is the chosen posture.
- **Tenant-scoped channels** (e.g. each tenant has its own SFTP folder) —
  Phase 8 channels remain operator-scoped. Per-tenant ingestion endpoints
  are a Phase 11 commercialization concern.
- **Audit log UI beyond a list view** — search/diff visualization waits.

---

## Open questions

These don't block Sprint 1 (defaults work), but worth answering before the
named sprint.

1. **(Sprint 2)** Which Clerk plan tier are you starting on? Free covers dev;
   Hobby ($25/mo) is the first that supports Organizations, which we need.
2. **(Sprint 4)** Do we keep the audit log in the same Postgres as the
   primary data, or push it to a separate write-ahead store (CloudWatch Logs,
   S3, etc.)? Default: same Postgres for v1, revisit on volume.
3. **(Sprint 5)** Are you OK doing the RDS encryption migration as a brief
   maintenance window (snapshot → restore-encrypted → swap), or do you want
   blue-green via Aurora? Default: maintenance window — simpler, cheaper.
4. **(Sprint 6)** Who signs off on the security checklist besides you? If
   nobody, the ADR records "self-reviewed" and you assume the risk; if a
   security-savvy advisor exists, route the checklist through them.

---

## Risk register (Phase 9 specific)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A write path forgets to inject `tenantId` | High | Critical | Prisma extension auto-injects; Sprint 6.2 direct DB inspection catches gaps |
| Clerk webhook delivery is unreliable | Medium | High | Idempotency on tenant + user creation; reconciliation script |
| Audit log volume balloons | Medium | Medium | Retention policy (Sprint 4); revisit storage in Phase 10 |
| RDS encryption migration causes downtime | Medium | Medium | Staging dry-run; documented runbook; scheduled window |
| Cross-tenant data bleed via a forgotten join | Medium | Critical | Prisma extension covers single-table queries; multi-table queries reviewed in Sprint 6 |
| Test fixtures aren't tenant-aware → false sense of safety | High | High | Sprint 1 retrofits every fixture; Sprint 6 verifies live |
