# Load-test baseline log

> Append a row after every load run that meets Gate E thresholds. Two
> consecutive within-10% rows are the Phase 10 exit signal for load.
>
> See `ops/load/README.md` for how to run; `BUILD_PLAN.md` Phase 10
> §Locked decision gates for Gate E numbers.

## Gate E targets

| Path | Throughput | p95 | Error rate |
|---|---|---|---|
| Read (`/lifecycle`, `/transactions`, `/search`, `/partners-config`) | 100 req/s sustained | < 500 ms | < 1% |
| Ingest (`/ingest/upload`) | 10 req/s | < 2 s | < 5% |

## Runs

| Date (UTC) | Commit | Env | Script | VUs | Achieved req/s | p95 | Error rate | Notes |
|---|---|---|---|---|---|---|---|---|
| _<example>_ 2026-08-15 | `abc1234` | staging | read.js | 50 | 84 | 312 ms | 0.2% | First baseline. DB pool maxed at 12/20; consider bumping if traffic doubles. |
| _<example>_ 2026-08-15 | `abc1234` | staging | ingest.js | 5 | 9.4 | 1180 ms | 0.0% | Within budget. S3 PUT stayed under 25/s. |

<!-- New rows below. Keep chronological; newest at the top. -->
