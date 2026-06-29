# EDI Data Hub

An EDI observability platform. Ingests inbound/outbound X12 EDI transactions,
decomposes them into structured data, and presents a single hub for monitoring,
searching, troubleshooting, and alerting.

**North Star:** Transaction lifecycle stitching — pull up a PO number and see
the 850, 855, 856, 810, and all 997s in one chronological view.

**Planning:** **What's next** → [`BUILD_PLAN.md`](BUILD_PLAN.md) · **What's shipped** → [`docs/SHIPPED.md`](docs/SHIPPED.md) · **Product wiki** → [`docs/WIKI.md`](docs/WIKI.md) · **Security sign-off** → [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md) · **AI builder rules** → [`AGENTS.md`](AGENTS.md) · **Local dev** → [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md)

**Tests:** 436 automated (`npm run test:ci`) · Node 20+ (CI uses Node 22)

---

## Features

What is **shipped in the repo today** (Phases 0–10 + desktop track).

### Ingestion & storage

- **Channels:** Authenticated HTTP upload (`POST /ingest/upload`), SFTP folder-watch, AS2 (OpenAS2)
- **Raw file storage:** S3/MinIO (SaaS) or local filesystem (desktop); SHA-256; tenant-scoped ISA control-number dedup
- **Failure handling:** Empty/oversized/unrecognized files classified; S3-before-DB ordering; structured logging; `/health` and `/readiness`

### Parsing & data model

- **X12 decomposition:** ISA → GS → ST/SE → segments → elements in PostgreSQL
- **Typed interpreters:** 850, 855, 856, 810, 860, 875, 880, 997/999 with semantic labels and business keys
- **Lifecycle linking:** Standard (850-based) and grocery (875→880) flows; 997 acks linked to referenced transactions
- **Robustness:** Z-segments, 5010, CRLF, repeated segments; per-transaction `PARSE_ERROR` without losing siblings; idempotent re-parse + backfill

### Data Hub UI (web)

- Filterable, paginated transaction list with URL-reflected filters
- Transaction detail: typed header, line items, labeled element tree
- **Raw vs parsed** side-by-side view with highlight sync
- Global search (PO / invoice / shipment ID / ISA control number)
- **Lifecycles homepage:** paginated PO list, expand-in-place timeline, due dates, filters, pins, saved views, bulk export
- **Lifecycle detail page:** vertical timeline with gaps, duplicate compare, expandable 997 AK detail, inline raw, export
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

## Quickstart (local — $0)

No AWS required. Full guide: [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md).

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d            # Postgres + MinIO + SFTP
npm run db:migrate
npm run dev:api                 # http://localhost:3000
npm run dev:web                 # http://localhost:5173 (proxies /api)
```

### Ingest a test file

```powershell
curl.exe -F "file=@apps/api/test/fixtures/sample_850.edi" http://localhost:3000/ingest/upload
curl.exe http://localhost:3000/health
```

### SFTP channel

```powershell
# SFTP_WATCH_ENABLED=true in .env, restart API
sftp -P 2222 edi@localhost    # password: edi
# put file into incoming/
```

MinIO console: http://localhost:9001 (minioadmin / minioadmin)

---

## Verify

```powershell
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
