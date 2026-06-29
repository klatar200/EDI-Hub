# Load testing

> Phase 10 Sprint 5. Two k6 scripts cover the dominant API paths.
> Targets from BUILD_PLAN Gate E. Baseline lives in `baseline.md`.

## Quick start

```bash
# 1. Install k6 (one-time):       brew install k6   |   choco install k6
# 2. Mint a JWT for a load-test tenant in your staging Clerk environpment
#    (create a `load-test` org + admin user; copy the session JWT from a
#    signed-in browser session, or use the Clerk SDK's getToken()).
# 3. Run the read profile against staging:
k6 run \
  -e BASE_URL=https://api.staging.edihub.example.com \
  -e BEARER=<JWT> \
  -e PO_NUMBER=PO-LOAD-SAMPLE \
  -e PARTNER_ID=SYSCO-LIVE \
  ops/load/k6/read.js

# 4. Run the ingest profile:
k6 run \
  -e BASE_URL=https://api.staging.edihub.example.com \
  -e BEARER=<JWT> \
  ops/load/k6/ingest.js
```

## Profiles

| Script | Scenario | VUs (default) | Duration | Threshold |
|---|---|---|---|---|
| `read.js` | ramping-vus 0 → 50 → 0 | `VUS` (default 50) | 150 s | p95 < 500 ms reads, error < 1% |
| `ingest.js` | constant-vus | `VUS` (default 5) | 60 s | p95 < 2 s, error < 5% |
| `abuse-rate-limit.js` | shared-iterations burst | 10 VUs | ≤ 60 s | at least one 429 + `Retry-After` |

`BASE_URL` is the **origin only** (no `/api` suffix). Scripts call `/api/...` routes.

Both scripts use `k6 thresholds` so a failed run exits non-zero — wire
into CI when the staging environment is reachable from the runner.

### Rate-limit abuse check (SEC-3)

After deploy (or locally with dev-fallback):

```bash
# Local — API on :3000, CLERK_SECRET_KEY blank (dev-fallback grants admin)
k6 run -e BASE_URL=http://localhost:3000 ops/load/k6/abuse-rate-limit.js

# Staging — real Clerk JWT for the load-test tenant
k6 run -e BASE_URL=https://app.staging.edihub.example.com \
  -e BEARER=<JWT> \
  ops/load/k6/abuse-rate-limit.js
```

Confirm `rate.exceeded` appears in Admin → Audit log for the tenant. This
is the BUILD_PLAN §4 Sprint A2 “rate limit live” receipt alongside `rate-limit.test.ts`.

## Tuning knobs

| Env var | Default | When to set |
|---|---|---|
| `VUS` | 50 (read) / 5 (ingest) | Push beyond Gate E once baseline is stable to confirm headroom. |
| `PO_NUMBER` / `INVOICE_NUMBER` / `PARTNER_ID` | none | Real fixtures from your staging tenant. Read script skips routes that don't have a fixture set. |

## What to look at

While the test runs, watch in parallel:

| Signal | Where | Why |
|---|---|---|
| API p95 + error rate | k6 stdout summary | Gate E pass/fail. |
| API CPU + memory | ECS task metrics | Spot CPU saturation before latency cliffs. |
| RDS CPU + connections | RDS Performance Insights | DB connection pool exhaustion shows up here as 503s in k6 + queueing in PI. |
| S3 PUT count + 5xx | S3 metrics | Throttling shows as 503 on the SDK retry path. |
| Rate-limit `X-RateLimit-Remaining` | k6 response headers | If reaching zero before Gate E target, the bucket needs widening (or the test is genuinely abusive). |

## Recording a baseline

After two consecutive runs land within 10% on every threshold, append a
row to `baseline.md` so future regressions are obvious. The baseline is
the receipt that "performance is met or revised with justification" —
that's the Gate E exit signal.
