# EDI Data Hub — Future & Optional Features

**Purpose:** Nice-to-have and deferred-not-rejected items. **Not on the active roadmap** — product backlog (F1–F62) is complete.

**Active roadmap:** [`BUILD_PLAN.md`](BUILD_PLAN.md) §3 · **Shipped features:** [`docs/FEATURE_STATUS.md`](docs/FEATURE_STATUS.md)

Review items here when planning post-launch sprints. Each entry should serve monitoring, troubleshooting, alerting, or stability — or belong in Phase 11+ commercial/enterprise tier.

---

## Architecture & infrastructure

| Feature | Notes |
|---|---|
| **BullMQ + Redis scheduler** | Today: sync ingestion + cron/Task Scheduler for detection/retention. Add when sub-minute cadence or queue observability justifies Redis. Deferred per [ADR 0001](docs/adr/0001-w3.1-synchronous-ingestion-with-reconcile.md). |
| **Per-tenant `OUR_ISA_IDS`** | Verify at deploy; may already be tenant-scoped. |
| **CORS / split-origin** | Only when production deliberately uses separate `app.` and `api.` hosts. Default is same-origin per [ADR 0002](docs/adr/0002-w3.2-same-origin-default-cors-escape-hatch.md). |
| **WAF on ALB** | Revisit if abuse appears post-launch. |
| **Multi-region failover** | Phase 12+ enterprise tier. |
| **APM / distributed tracing** | OpenTelemetry or Datadog when the call graph goes multi-service. |
| **Per-tenant KMS (BYOK)** | Phase 11+ enterprise tier. |
| **Postgres row-level security** | Duplicates Prisma tenant extension; not planned for v1. |
| **Audit log streamed to CloudWatch / S3** | Same Postgres for v1. |
| **SOC 2 / external pen test** | When first regulated buyer requires it. |

---

## Monitoring & alerting (not in v1 backlog)

| Feature | Notes |
|---|---|
| **PagerDuty / Opsgenie** | Beyond email + Slack. |
| **Escalation chains** | Notify A, then B if not acked in N minutes. |
| **Calendar-aware SLAs** | Business hours, weekdays, holidays on top of flat `withinMinutes`. |
| **Calendar-aware quiet hours** | Suppress alert delivery overnight/weekends (flat quiet hours shipped in F13). |
| **ML-based rejection-rate anomaly** | Beyond flat threshold in detection. |
| **Richer escalation contacts** | Phone, Slack handles, on-call rotations. |
| **999 IK3/IK4 deep parsing** | When a 5010 partner needs it (997-only today). |
| **Due-date sort on lifecycle list** | Due column shipped (F27); sort/filter by due date deferred until a customer asks. |

---

## Parser & data (optional)

| Feature | Notes |
|---|---|
| **Tier C transaction sets** | 999, proprietary Z-segments beyond current parser tolerance. See glossary Tier C in app. |
| **Line-level multi-PO on 810** | Header-level multi-PO linking shipped (F37); per-IT1 PO refs if partners require it. |

---

## Polish & remediation (low priority)

| ID | Feature | Summary |
|---|---|---|
| **W4.1** | Clerk webhook reconcile script | `reconcile-clerk.ts` for out-of-order org/membership delivery. |
| **W4.2** | Authenticated raw-file viewing | Ensure UI uses fetch+blob, not bare URL links under Clerk auth. |

---

## Desktop optional polish

### OPTIONAL-D1 — Boot log noise cleanup

Remove harmless warnings from packaged Windows installs. ~0.5 sprint.

### OPTIONAL-D2 — Client updating sequence

Predictable release + auto-update polish. See `apps/desktop/RELEASE.md`, `apps/desktop/UPDATE_SCORECARD.md`. ~1 sprint.

---

## Commercial & platform (Phase 11+)

| Feature | Notes |
|---|---|
| **Stripe self-serve checkout** | vs direct/contract sales — Gate 4 decision pending. |
| **Marketing / landing site** | Phase 11. |
| **Per-tenant storage / ingestion quotas** | Beyond rate limiting. |
| **Linux desktop (AppImage)** | Deferred until first paying desktop customer asks. |

---

## Explicitly out of scope for v1

VAN/transmission, mapping editor, ERP connectors, chargeback workflows, sitting in the live transmission path.
