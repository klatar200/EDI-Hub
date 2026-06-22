# Restore Drill Log

> Append a row after every restore drill. Quarterly minimum (BUILD_PLAN
> Phase 10 exit criteria). Untested backups are aspirational; this log
> is the receipt that they aren't.
>
> See `ops/RUNBOOKS.md#drilling-the-restore` for the procedure.

| Date (UTC) | Operator | Source backup | Restore path | Elapsed | Smoke checks | Notes / fixes |
|---|---|---|---|---|---|---|
| _<example>_ 2026-07-01 | Keagan | s3://edi-hub-backups-prod/edi-hub/2026-W26/db.dump | B (pg_dump) | 42 min | 4/4 pass | First drill; required pgcrypto extension to be re-created post-restore — runbook updated. |

<!-- New rows below. Keep newest first; oldest at the bottom. -->
