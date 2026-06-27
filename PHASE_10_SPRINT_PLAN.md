# Phase 10 — Production Readiness & Operations: Sprint Plan

> **Phase status:** Phase 10 is **code-complete** (M5 in code). Operator drills and deploy checklist: **`BUILD_PLAN.md`** § Deploy track · **`ops/PRE_PRODUCTION_TODO.md`**. This file is historical sprint detail.

**Phase goal:** Make the system survivable in the real world. Before Phase
10 the app boots, accepts traffic, and is secure (Phase 9). After Phase 10
it can be operated by a person who isn't the author — logs are searchable,
metrics are alertable, backups have been restored at least once, and an
incident runbook exists.

**Exit criteria (= BUILD_PLAN Phase 10 exit):**
- Load test passes at projected volume (numeric target picked in Sprint 5).
- Backup restore drilled end-to-end in staging (not just "backups exist").
- Data retention enforced for raw files, audit events, and alerts.
- Rate limiting + size limits in place on the public API.
- Written incident runbooks for the top failure modes.

**Estimated effort:** 2–4 weeks at 15–25 hrs/week. Smaller than Phase 9
because the code volume is lower, but the verification cycles (drilling a
restore, running a load test, walking through a runbook) are wall-clock
heavy.

**Milestone reached:** M5 — Production-ready.

**Builds on:**
- Phase 8 channel registry (health reporting per channel).
- Phase 9 secrets loader (rate-limit + backup-restore credentials live there).
- Phase 9 audit log (retention policy lands here).

---

## Locked decision gates (defaults below; override if needed)

| Gate | Default | Why |
|---|---|---|
| **A — Metrics backend** | Prometheus scrape endpoint on the API (`/internal/metrics`), Grafana for dashboards. | Open-source, single binary; cheap to host on the existing VPC. CloudWatch is the alternative — pick it only if you want one fewer thing to operate. |
| **B — Log aggregation** | CloudWatch Logs (the ECS task driver ships stdout there for free). | Zero extra infra; pgaudit / Loki are deferrable. |
| **C — Backup cadence** | RDS automated snapshots daily (already on from Phase 9 Sprint 5) + one weekly logical `pg_dump` to a separate S3 bucket. | Two-layer protection: snapshot for fast restore, logical dump for cross-region disaster recovery. |
| **D — Rate-limit strategy** | Token bucket per (tenant, route group), in-memory per task with sticky sessions disabled. Redis-backed when traffic justifies. | In-memory is good enough for v1; Redis is a Sprint-7 problem. |
| **E — Load-test target** | 100 req/s sustained at p95 < 500 ms for read endpoints; 10 ingestions/s at p95 < 2 s. Pilot's actual traffic is ~5 req/s; we're sizing for headroom. | Numbers based on the pilot's observed volume × 20. Revisit when the first external customer signs. |

---

## What changes vs. Phase 9

| Layer | Today (Phase 9) | Phase 10 adds |
|---|---|---|
| **Logging** | Fastify pino at `info` to stdout. | Structured request logs (`reqId`, `tenantId`, `route`, `latencyMs`, `outcome`). CloudWatch log group with retention. |
| **Metrics** | None on the app itself. | `prom-client` exposing request count / latency histogram / channel health / queue depth (when BullMQ lands). `/internal/metrics` scrapable from inside the VPC. |
| **Health** | `/health` returns 200 + DB/S3/channel status. | Add `/readiness` (separate from liveness): returns 200 only when the API has fully booted (DB schema migrated, channels started). The ALB target group uses `/readiness`; ECS uses `/health` for liveness. |
| **Backups** | RDS automated snapshots (Phase 9 Sprint 5). | Documented restore runbook + a quarterly restore drill recorded in `ops/RESTORE_LOG.md`. Weekly logical `pg_dump` → separate S3 bucket with object lock. |
| **Retention** | None — every raw file + audit row lives forever. | Configurable per-table retention. Default: raw files 18 months, parsed tree 18 months, audit events 365 days (deferred-delete to 730), alerts 365 days. |
| **Rate limiting** | None. | `@fastify/rate-limit` on the public surface. Per-tenant buckets; the `/ingest/upload` route gets a separate, tighter bucket. |
| **Load testing** | None. | `ops/load/k6/` scripts that hit the staging API. Baseline run committed to `ops/load/baseline.md`. |
| **Incident response** | None written. | `ops/RUNBOOKS.md` covering: DB down, S3 unreachable, ingestion queue backed up, Clerk webhook drift, tenant deletion request. |

---

## Pre-sprint architecture decisions

| Question | Decision | Reason |
|---|---|---|
| Where do incident runbooks live? | `ops/RUNBOOKS.md` (single file in the repo). | One Cmd-F to find anything; PR review keeps them current. |
| What format are metrics in? | OpenMetrics / Prometheus exposition format via `prom-client`. | Industry standard; works with Grafana, Datadog, and CloudWatch alike. |
| Liveness vs readiness | Liveness checks the process is alive (no DB query). Readiness checks DB + S3 + channels. | Kubernetes/ECS convention — a slow DB shouldn't trigger a restart loop. |
| Restore drill cadence | Quarterly minimum, logged in `ops/RESTORE_LOG.md`. | Industry-standard SOC2/ISO floor; cheap insurance. |
| Tenant deletion timeline | Soft-delete on request → 30-day grace → hard-delete (cascade on tenantId). | GDPR-friendly; gives the tenant a window to reverse. |

---

## Sprint plan

> Effort estimates assume 15–25 hrs/week solo with Opus 4.8. Sprints 1, 3, 4
> are code-heavy and Opus-compressible. Sprints 2 + 5 + 6 are wall-clock
> heavy (waiting for restores, running load tests, walking through runbooks).

### Sprint 1 — App-level observability (Week 1)

**Goal:** Anyone reading the logs or metrics can answer "what is the API
doing right now?" without SSHing to the container.

**Tasks:**
- **1.1 — Structured request logs.** Fastify already emits per-request logs;
  enrich with `reqId`, `tenantId`, `route`, `latencyMs`, and final HTTP
  status code. Strip PII (we already don't log partner data; tighten the
  assertion via a serializer).
- **1.2 — Prom metrics endpoint.** `/internal/metrics` (no auth, VPC-only)
  exposing request count, latency histogram (per route), in-flight requests,
  channel health gauge.
- **1.3 — Liveness / readiness split.** New `/readiness`; ALB target group
  flips to it. `/health` becomes the liveness probe (no external deps).
- **1.4 — Log group + CloudWatch retention.** Terraform: CloudWatch log
  group with 30-day retention by default, 90 days for `prod`.
- **1.5 — Tests.** Metrics endpoint returns a parsable exposition format;
  readiness returns 503 when a dep is down; request-log serializer drops
  forbidden fields.

**Acceptance:** A `curl /internal/metrics` from inside the VPC returns
real numbers. CloudWatch Logs Insights query `fields @message | filter
tenantId = '...'` returns only that tenant's request lines.

**Effort:** ~1 week.

---

### Sprint 2 — Automated backups + tested restore (Week 1-2)

**Goal:** A new operator can restore the DB into a fresh environment using
only `ops/RUNBOOKS.md`, and the steps work end-to-end.

**Tasks:**
- **2.1 — Logical backup job.** Weekly `pg_dump --format=custom` → separate
  S3 bucket with object lock + cross-region replication. ECS scheduled task
  + a tiny container that pulls credentials from Secrets Manager.
- **2.2 — Restore runbook.** Step-by-step from snapshot or `pg_dump` into a
  new RDS instance. Includes the Prisma `migrate deploy` + smoke test.
- **2.3 — Drill.** Restore the most recent backup into a `restore-test` RDS
  instance in staging. Verify row counts match. Record outcome in
  `ops/RESTORE_LOG.md`.
- **2.4 — Backup health alarm.** CloudWatch alarm fires if the weekly
  backup job hasn't succeeded in 10 days. Alarm routes to the same Slack
  channel as Phase 7 alerts.

**Acceptance:** Restore drill completes in under an hour; runbook is
copy-pasteable; alarm has fired in a dry run.

**Effort:** ~1 week (most of it wall-clock waiting for RDS create + restore).

---

### Sprint 3 — Data retention enforcement (Week 2)

**Goal:** Old data ages out per the documented policy. Storage costs and
breach surface stay bounded.

**Tasks:**
- **3.1 — Policy table.** `retention_policies` (or `Tenant.retention JSONB`)
  carrying TTL per category. Defaults: raw files 18mo, parsed tree 18mo,
  audit events 365 days (soft-deleted to 730), alerts 365 days.
- **3.2 — Retention worker.** Daily background job (BullMQ when present;
  bare `setInterval` until then) that deletes / soft-deletes per policy.
  Idempotent; writes a `retention.run` audit row.
- **3.3 — Raw-file lifecycle.** S3 lifecycle rule moves objects to
  `STANDARD_IA` at 90 days and deletes at the configured TTL. Database
  rows for deleted S3 objects flip to `status=ARCHIVED` (not removed) so
  the lineage trail survives.
- **3.4 — Tenant deletion path.** `DELETE /tenants/:id` (admin-only, scoped
  to the calling tenant — i.e. self-delete only). Soft-delete sets a
  `deletedAt`; a sweeper hard-deletes after 30 days with `tenantContext.bypass`.
- **3.5 — Tests.** Retention worker dry-run logs every candidate row; soft-
  delete + hard-delete paths exercised; tenant deletion respects the
  30-day grace.

**Acceptance:** A row inserted "366 days ago" with retention=365 is gone
after one worker pass. Tenant soft-delete + hard-delete leaves zero rows
behind.

**Effort:** ~1 week.

---

### Sprint 4 — Rate limiting + abuse protection (Week 2-3)

**Goal:** A single tenant can't accidentally (or maliciously) saturate the
API and degrade service for others.

**Tasks:**
- **4.1 — `@fastify/rate-limit`.** Per-tenant token bucket: 600 req/min for
  reads, 60 req/min for writes, 10 req/min for `/ingest/upload`. Bucket
  key is `request.tenantId` (set by the tenant plugin); fall back to the
  remote IP for unauthenticated routes (`/health`, `/webhooks/clerk`).
- **4.2 — Body / multipart size limits.** Already enforced via
  `maxFileSizeBytes`; add a request-body size limit (25 KB default,
  10 MB for `/ingest/upload`).
- **4.3 — `429 Too Many Requests` shape.** Standard error envelope with a
  `Retry-After` header. Audit-log the over-limit event (action=`rate.exceeded`)
  so we can spot abuse.
- **4.4 — Webhook protection.** `/webhooks/clerk` gets a separate, tighter
  bucket keyed by source IP — Svix signatures are still verified, but a
  malformed-signature flood shouldn't be cheap.
- **4.5 — Tests.** A loop that exceeds the bucket gets a clean 429 with
  `Retry-After`; the audit row appears.

**Acceptance:** Sprint 5's load test plan documents the bucket sizes; the
audit-log query for `rate.exceeded` returns no rows under normal load and
plenty under the test.

**Effort:** ~3–5 days.

---

### Sprint 5 — Load test + performance baseline (Week 3)

**Goal:** A documented, repeatable load run that exercises the read +
ingestion paths, so future regressions are obvious.

**Tasks:**
- **5.1 — k6 scripts.** `ops/load/k6/read.js` (lifecycle + transactions +
  search), `ops/load/k6/ingest.js` (multipart upload of a 50 KB sample
  850). Both parameterized by `BASE_URL` and `BEARER`.
- **5.2 — Staging run.** Run against staging at the Gate-E targets.
  Capture latency histogram, error rate, S3 PUT count, DB connection
  pool utilization.
- **5.3 — Baseline doc.** `ops/load/baseline.md` records the date, commit
  SHA, environment, target numbers, and what observed. Future runs compare.
- **5.4 — Capacity callouts.** Document the failure mode for each
  exhausted resource (DB pool full → 503; S3 throttle → retry/backoff
  already in place; multipart timeout → 413). The runbook (Sprint 6)
  links to the relevant section.
- **5.5 — Iterate if numbers don't meet Gate E.** Either tune (connection
  pool, indices) or revise the target with a written justification.

**Acceptance:** Two consecutive baseline runs land within 10% of each
other on every metric. Targets met or revised with justification.

**Effort:** ~1 week (mostly running + iterating).

---

### Sprint 6 — Incident runbooks + on-call documentation (Week 3-4)

**Goal:** When something breaks at 2 AM, the person reading the runbook
can resolve it (or escalate confidently) without paging the author.

**Tasks:**
- **6.1 — `ops/RUNBOOKS.md`.** One section per failure mode:
  - DB unreachable (RDS down, network ACL change, password rotated).
  - S3 unreachable.
  - Channel queue backed up (SFTP / AS2 drop-folder filling).
  - Clerk webhook delivery drift (org created in Clerk but not in `Tenant`).
  - Tenant deletion request.
  - Suspected cross-tenant data leak (the nuclear runbook).
  - Audit row missing (`withAudit` failure).
- **6.2 — Each section has: symptoms, first checks, mitigation, rollback,
  who-to-tell.**
- **6.3 — Alert mapping.** Every CloudWatch alarm + Phase 7 alert links to
  the runbook section that handles it. Reverse map at the top of
  `RUNBOOKS.md` so an alert subject line is one click from the playbook.
- **6.4 — Walk-through.** Dry-run each runbook against a paused staging
  environment. Fix gaps. Sign off.
- **6.5 — `ops/SUPPORT.md`.** Who handles what when the operator can't
  resolve it themselves (defer to the author for now; reframe when the
  team grows).

**Acceptance:** Self-review pass: read the runbook cold (a week after
writing it) and try to resolve a contrived failure using only its text.

**Effort:** ~3–5 days.

---

## Milestone summary

| After sprint | What's proven |
|---|---|
| Sprint 1 | Logs + metrics let an operator answer "what is happening" |
| Sprint 2 | Backups are real, not aspirational |
| Sprint 3 | Data ages out; storage and breach surface stay bounded |
| Sprint 4 | A single noisy tenant can't degrade the others |
| Sprint 5 | Performance is measured, not asserted |
| Sprint 6 | M5 reached — survivable in the real world |

---

## Testing approach

- **Sprint 1:** Unit tests for the metrics serializer + readiness aggregator;
  manual `curl` of `/internal/metrics` in staging.
- **Sprint 2:** Drill is the test. Recorded in `ops/RESTORE_LOG.md`.
- **Sprint 3:** Tests advance the clock with injected `now()`; assert
  retention worker deletes exactly the expected rows.
- **Sprint 4:** Loop test confirms 429 after N requests; audit row asserted.
- **Sprint 5:** Two consecutive baseline runs within 10%.
- **Sprint 6:** Cold-read walk-through.

---

## Explicitly out of scope

- **APM / distributed tracing** — Prometheus + structured logs are enough
  for v1. OpenTelemetry / Datadog APM revisit when the call graph gets
  multi-service.
- **Per-tenant resource quotas beyond rate limiting** — storage caps,
  ingestion volume caps land in Phase 11 commercialization.
- **Multi-region failover** — Phase 12+ enterprise tier.
- **Chaos engineering / game days** — out of scope until there's a team
  to run them.
- **PII redaction in logs beyond the existing `tenantId / route / status`
  shape** — current logs don't carry partner content; revisit only if
  that changes.

---

## Open questions

These don't block Sprint 1 (defaults work), but worth answering before
the named sprint.

1. **(Sprint 1)** CloudWatch Logs vs Loki vs Datadog. Default CloudWatch
   because the ECS driver ships logs there for free. Revisit if billing
   surprises appear.
2. **(Sprint 2)** Logical backup target bucket — same account, different
   region? Or a separate "audit" account? Default: same account, different
   region. Separate-account adds blast-radius isolation; revisit at first
   external customer.
3. **(Sprint 3)** Tenant retention policy: per-tenant override, or one
   global default? Default: one global default, per-tenant override is a
   Phase 11 paid feature.
4. **(Sprint 4)** Rate-limit bucket sizes — the defaults are pilot-based.
   Confirm against actual usage before sprint start.
5. **(Sprint 5)** Load-test traffic source — k6 cloud, self-hosted on a
   second EC2, or local? Default: local k6 hitting staging (cheapest;
   sufficient for the Gate-E target).
6. **(Sprint 6)** On-call rotation — currently you alone. Make sure the
   runbook is written for the "future second person" too.

---

## Risk register (Phase 10 specific)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Backups exist but restore is untested | High | Critical | Sprint 2 drill is mandatory before exit |
| Metrics endpoint exposed to public internet | Medium | High | VPC-only; ALB security group denies external 9100 |
| Retention deletes wrong rows (off-by-one on TTL) | Medium | High | Dry-run mode + audit row before destructive delete |
| Rate limit too aggressive — kicks the pilot off | Medium | Medium | Buckets are tenant-scoped and overridable; alarm on `rate.exceeded` flood |
| Load test exposes a regression we can't fix in scope | Medium | Medium | Document, write the issue, revise Gate E with justification |
| Runbooks rot the moment they're written | High | Medium | Quarterly walk-through; alert-subject → runbook link forces them to stay current |
