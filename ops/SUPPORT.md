# Support & Escalation

> Who handles what when an operator can't resolve it from the runbook
> alone. Single-author today; the structure assumes a second person
> joins eventually — when that happens, change "the author" to specific
> names and rotate.

## Roles

| Role | Today | Future state |
|---|---|---|
| **L1 on-call** | The first person reading a Slack alert. | Rotates weekly across the team. |
| **L2 author** | Keagan — single point. | Domain-area owners (parser, ingestion, RBAC, infra). |
| **Customer success** | Keagan — single point. | Dedicated CS once the first paid customer signs. |

## When to escalate

| Situation | L1 handles | Escalate to L2 |
|---|---|---|
| Backup stale, runbook fix applies | ✅ | If runbook doesn't resolve in 1 h. |
| DB / S3 unreachable, mitigation in runbook | ✅ | If unresolved in 30 min OR scope is region-wide. |
| Channel queue backed up | ✅ | If > 4 h of accumulation. |
| Clerk webhook drift | ✅ | If > 1 h — new signups failing. |
| Tenant deletion request | ✅ | If legal pressure for sub-grace-window hard delete. |
| Performance regression < 2× target | ✅ — apply runbook | If > 2× and code change suspected. |
| **Cross-tenant data leak** | ❌ | **Page L2 immediately.** Do not investigate alone. |
| Audit row missing — single user | ✅ | If pattern across many users. |
| Anything not in RUNBOOKS.md | ❌ | Always — write it up afterwards. |

## How to page L2 (today)

1. Slack DM (response SLA: 30 min business hours, 2 h after hours).
2. If urgent and Slack unanswered after 15 min, SMS the author's
   recorded phone number (stored in 1Password under "EDI Hub —
   on-call").

## What to include in a page

Copy-paste this template:

```
ENVIRONMENT: prod | staging
ALARM / SYMPTOM: <one line>
WHEN STARTED: <UTC timestamp>
WHO REPORTED: <tenant name | self-detected | CW alarm>
RUNBOOK SECTION TRIED: <link to RUNBOOKS.md#...>
FIRST CHECKS COMPLETED: <list>
CURRENT STATE: <ongoing | mitigated | unclear>
PRESERVED EVIDENCE: <S3 key | log link | screenshot path>
```

For cross-tenant suspected leaks, set CURRENT STATE = `EVIDENCE
PRESERVED, NOT MITIGATED` and STOP — that flag means L2 will take
over before any corrective action runs.

## After every page

- Update the runbook section that didn't fully cover the case.
- Add a row to the relevant log (`RESTORE_LOG.md`, `baseline.md`,
  or a new `INCIDENT_LOG.md`).
- If the page was a false alarm, tune the alarm threshold and note
  the change in `infra/alarms.tf`.
