# EDI Data Hub — Future & Optional Features

**Purpose:** Nice-to-have and deferred-not-rejected items. Not on the active roadmap in `BUILD_PLAN.md`. Review when planning a sprint; add new items here with one line on *why* it was deferred.

**Anti-drift rule:** Each item must eventually serve monitoring, troubleshooting, alerting, or stability — or belong in Phase 11+ commercial/enterprise tier.

---

## Architecture & infrastructure

| Feature | Notes |
|---|---|
| **BullMQ + Redis scheduler** | Today: sync ingestion + cron/Task Scheduler for detection/retention. Add when sub-minute cadence or queue observability justifies Redis. See BUILD_PLAN §8 open item W3.1. |
| **Per-tenant `OUR_ISA_IDS`** | Replace single global env var with per-tenant config (may already be partially done — verify at deploy). |
| **CORS / split-origin** | Only if production uses separate `app.` and `api.` hosts without a reverse proxy. See BUILD_PLAN §8 W3.2. |
| **WAF on ALB** | Revisit if abuse appears post-launch. |
| **Multi-region failover** | Phase 12+ enterprise tier. |
| **APM / distributed tracing** | OpenTelemetry or Datadog when the call graph goes multi-service. |
| **Per-tenant KMS (BYOK)** | Phase 11+ enterprise tier. |
| **Postgres row-level security** | Duplicates Prisma tenant extension; not planned for v1. |
| **Audit log streamed to CloudWatch / S3** | Same Postgres for v1. |
| **SOC 2 / external pen test** | When first regulated buyer requires it. |

---

## Monitoring & alerting

| Feature | Notes |
|---|---|
| **Stale-traffic alert** | Fire when a partner's last ingestion is older than 2× their highest SLA. |
| **PagerDuty / Opsgenie** | Beyond email + Slack. |
| **Escalation chains** | Notify A, then B if not acked in N minutes. |
| **Calendar-aware SLAs** | Business hours, weekdays, holidays on top of flat `withinMinutes`. |
| **Calendar-aware quiet hours** | Suppress alert delivery overnight/weekends. |
| **ML-based rejection-rate anomaly** | Beyond flat threshold in detection. |
| **Richer escalation contacts** | Phone, Slack handles, on-call rotations (Phase 6 is email-only). |
| **999 IK3/IK4 deep parsing** | When a 5010 partner needs it (997-only today). |

---

## Parser & data

| Feature | Notes |
|---|---|
| **860 / 875 / 880 sets** | Parser interprets these beyond documented v1 set — document or gate (BUILD_PLAN §8 W4.3). |
| **Per-partner dictionary override UI** | Schema exists; editor stays JSON until ops wants a form. |

---

## Polish & remediation (low priority)

| ID | Feature | Summary |
|---|---|---|
| **W4.1** | Clerk webhook reconcile script | `reconcile-clerk.ts` for out-of-order org/membership delivery. |
| **W4.2** | Authenticated raw-file viewing | Ensure UI uses fetch+blob, not bare URL links under Clerk auth. |
| **W4.3** | Parser scope docs | Align `CLAUDE.md` with 860/875/880 support decision. |

---

## Desktop optional polish

### OPTIONAL-D1 — Boot log noise cleanup

Remove harmless warnings from packaged Windows installs (EPERM on `chmod postgres.exe`, "database already exists" on relaunch, Clerk dev-keys warning in release builds). ~0.5 sprint.

### OPTIONAL-D2 — Client updating sequence

Predictable release + auto-update: tag/version guardrails, CI asset integrity, `electron-updater` behavior, Help → About truth. See `apps/desktop/RELEASE.md`, `apps/desktop/UPDATE_SCORECARD.md`. ~1 sprint.

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
