# EDI Data Hub

An EDI observability platform. Ingests inbound/outbound X12 EDI transactions,
decomposes them into structured data, and presents a single hub for monitoring,
searching, troubleshooting, and alerting.

**North Star:** Transaction lifecycle stitching — pull up a PO number and see
the 850, 855, 856, 810, and all 997s in one chronological view.

**Planning:** Active roadmap → [`BUILD_PLAN.md`](BUILD_PLAN.md) · Optional/deferred → [`FUTURE_FEATURES.md`](FUTURE_FEATURES.md) · Agent conventions → [`CLAUDE.md`](CLAUDE.md) · Parser deviations → [`docs/EDI_DEVIATIONS.md`](docs/EDI_DEVIATIONS.md)

**Tests:** 383 automated (`npm run test:ci`) · Node 20+ (CI uses Node 22)

---

## Features

What is **shipped in the repo today** (Phases 0–10 + desktop track).

### Ingestion & storage

- **Channels:** Authenticated HTTP upload (`POST /ingest/upload`), SFTP folder-watch, AS2 (OpenAS2)
- **Raw file storage:** S3/MinIO (SaaS) or local filesystem (desktop); SHA-256; tenant-scoped ISA control-number dedup
- **Failure handling:** Empty/oversized/unrecognized files classified; S3-before-DB ordering; structured logging; `/health` and `/readiness`

### Parsing & data model

- **X12 decomposition:** ISA → GS → ST/SE → segments → elements in PostgreSQL
- **Typed interpreters:** 850 (PO), 810 (invoice) with semantic labels and business keys (PO/invoice numbers)
- **Lifecycle linking:** 850/855/856/810 stitched by PO; 997 acks linked to referenced transactions
- **Robustness:** Z-segments, 5010, CRLF, repeated segments; per-transaction `PARSE_ERROR` without losing siblings; idempotent re-parse + backfill
- **Additional sets parsed (generic tree):** 855, 856, 997/999; extended sets 860/875/880 in parser (see `FUTURE_FEATURES.md`)

### Data Hub UI (web)

- Filterable, paginated transaction list with URL-reflected filters
- Transaction detail: typed header, line items, labeled element tree
- **Raw vs parsed** side-by-side view with highlight sync
- Global search (PO / invoice / ISA control number)
- **Lifecycle page:** vertical timeline with missing-document gaps, duplicate badges, expandable 997 AK detail, inline raw
- **Alerts page:** partner + type + age-vs-SLA chips, lifecycle deep links, ack/snooze
- Partners config, ingestions list (with upload panel), outbound stage badges
- Clerk authentication; role-aware UI

### Acknowledgments & monitoring

- **997 decoder:** AK1–AK5 / IK segments → plain-English rejection detail (AK3/AK4)
- **Rejection rates** per trading partner
- **Alerts:** Missing-ack vs partner SLA; rejection-rate spikes
- **Notifications:** Email (SES) and Slack webhook
- Alert history, acknowledge, snooze

### Trading partners

- Partner profiles: ISA IDs, supported transaction sets, SLA windows per type
- Escalation contacts (email); consumed by detection engine

### Security & multi-tenancy (SaaS)

- **Clerk** auth with Organizations → tenants; JWT on every route
- **RBAC:** `viewer` / `ops` / `admin` on every endpoint
- **Tenant isolation:** Prisma extension + AsyncLocalStorage context; cross-tenant → 404
- **Audit log** on every mutation (atomic with data write)
- Production auth guardrails; `requireTenantId()` throws in production without context
- AWS Secrets Manager integration; security headers; rate limiting

### Production operations (code)

- Retention worker (configurable TTLs on raw files, parsed tree, audit, alerts)
- `/internal/metrics` (Prometheus), structured request logs, CloudWatch log group (Terraform)
- Backup container + restore script; k6 load harness; incident runbooks (`ops/RUNBOOKS.md`)
- Detection + retention via cron / Task Scheduler (multi-tenant detection)

### Outbound & channels

- Outbound lifecycle: generated → transmitted → confirmed
- Channel registry with per-channel health in `/health`

### Desktop app (`apps/desktop`)

- **LAN server SKU:** Electron launcher + embedded Postgres + packaged API
- Same React UI as web (parity tests in CI)
- Users browse hub at `http://<server-ip>:3000` with Clerk auth
- Local raw file storage; DB-backed job queue (no Redis required)
- Windows installer, code signing, **electron-updater** auto-update
- Trial/licensing, first-run wizard, backup/restore ZIP, opt-in crash reporting

---

## Monorepo layout

```
apps/
  api/          Fastify API + ingestion pipeline
  web/          React + Vite + Tailwind UI
  desktop/      Electron LAN server + installer
packages/
  edi-parser/   Pure TS X12 parser
  db/           Prisma schema + tenant extension
  shared/       Shared types
infra/          Terraform (AWS); local dev uses docker-compose.yml
```

---

## Quickstart (local)

```bash
npm install
cp .env.example .env
docker compose up -d            # Postgres + MinIO + SFTP
npm run db:migrate
npm run dev:api                 # http://localhost:3000
npm run dev:web                 # http://localhost:5173 (proxies /api)
```

### Ingest a test file

```bash
curl -F file=@apps/api/test/fixtures/sample_850.edi http://localhost:3000/ingest/upload
curl http://localhost:3000/health
```

### SFTP channel

```bash
# SFTP_WATCH_ENABLED=true in .env, restart API
sftp -P 2222 edi@localhost    # password: edi
# put file into incoming/
```

MinIO console: http://localhost:9001 (minioadmin / minioadmin)

---

## Verify

```bash
npm run typecheck
npm run lint                  # zero warnings
npm run test:ci               # db + parser + api + web + desktop
npm run smoke --workspace=@edi/api   # live e2e (needs docker + migrated DB)
```

Run `npm install` from the **repo root** before `test:ci`.

| Workspace | Runner | Needs docker? |
|---|---|---|
| `@edi/db` | node:test | No |
| `@edi/edi-parser` | node:test | No |
| `@edi/api` | node:test | No (fake Prisma/S3) |
| `@edi/web` | Vitest | No |
| `@edi/desktop` | node:test | No |

---

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev:api` / `dev:web` | Dev servers |
| `npm run test:ci` | Full CI test matrix |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run infra:up` / `infra:down` | Local Postgres + MinIO + SFTP |
