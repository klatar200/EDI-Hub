# EDI Data Hub

An EDI observability platform. Ingests inbound/outbound X12 EDI transactions,
decomposes them into structured data, and presents a single hub for monitoring,
searching, troubleshooting, and alerting.

See `BUILD_PLAN.md` for the roadmap and `PHASE_1_SPRINT_PLAN.md` for the
sprint plan. Architecture notes are in `CLAUDE.md`; real-world parsing
deviations to expect are catalogued in `docs/EDI_DEVIATIONS.md`.

**North Star:** Transaction lifecycle stitching — pull up a PO number and see
the 850, 855, 856, 810, and all 997s in one chronological view.

## Monorepo layout

```
apps/
  api/          Fastify ingestion + API (TypeScript)
  web/          React + Vite + Tailwind UI (Data Hub browser, Phase 3)
packages/
  edi-parser/   X12 parsing library (pure TS; envelope IDs now, full parse Phase 2)
  db/           Prisma schema + client
  shared/       Cross-cutting types
infra/          Terraform (real AWS); local dev uses docker-compose.yml
```

## Phase 3 — Data Hub UI COMPLETE  ·  Milestone M1 "It's real"

**Sprint 1 (done): browse the data.** A real React + Vite + Tailwind app
(`apps/web`) backed by new read endpoints: filterable, paginated transactions
list (by set / partner / status / PO / invoice), `GET /partners`,
`GET /raw-files/:id/content` (raw bytes proxied from S3), and `GET /search?q=`
(PO / invoice / ISA control number). Run it with `npm run dev:web` (proxies to
the API).

**Sprint 2 (done): detail + raw/parsed.** A transaction detail page (typed
header, line items, labeled segment/element tree) and a **raw-vs-parsed**
side-by-side view (original bytes from `/raw-files/:id/content` next to the
parsed segments) with click-to-highlight in both panels. List rows link through
to the detail.

**Sprint 3 (done): search, filters, states.** Global search box (PO / invoice /
ISA control number) with a results page; transactions-list filters reflected in
the URL (shareable / bookmarkable, back-forward aware); skeleton loaders and
consistent empty/error states. **M1 reached** — the pilot's real traffic is
browsable, searchable, and inspectable to the element level. **63 automated
tests** (58 backend + 5 web).

## Phase 2 — Structured parsing COMPLETE

**Sprint 1 (done): envelope decomposition.** Every ingested X12 file is now
decomposed inline into a queryable tree — `interchanges` -> `functional_groups`
-> `transactions` -> `segments` -> `elements` — each row tracing back to its
`raw_files` record. Handles batched interchanges (multiple GS/ST) and flags
control-count mismatches as warnings. Parsing is idempotent (re-parse replaces,
never duplicates). `npm run backfill --workspace=@edi/api` (re)parses
already-ingested files.

**Sprint 2 (done): 850/810 semantics.** Each element is tagged with a semantic
label (e.g. BEG03 = "Purchase Order Number"), and each transaction's business
keys (PO number, invoice number, purpose) are extracted and stored for fast
lookup. New read API:
`GET /transactions/:id` (typed header + line items + labeled tree) and
`GET /transactions?po=&invoice=&set=`.

**Sprint 3 (done): robustness & exit.** Tolerates real-world deviations
(Z-segments preserved, repeated/missing segments, trailing empty elements,
CRLF wrapping, 5010). Per-transaction validation: a semantically broken
transaction (e.g. an 850 with no PO number) is still persisted as a generic
tree but flags the file `PARSE_ERROR` with a message naming the field, while
sibling transactions in the same file still parse. **54 automated tests.**

## Status — Phase 1 (Ingestion Spike) COMPLETE

**Sprint 1 — foundation & upload.** A file POSTed to `/ingest/upload` is stored
in object storage (S3/MinIO), hashed (SHA-256), and recorded in `raw_files`.
S3 write happens before the DB write, so a file is never lost on a DB failure.

**Sprint 2 — dedup, logging, retry, SFTP, status.** Deduplication on the ISA13
control number (no second S3 write); two ingestion channels (HTTP + SFTP
folder-watch) over one shared pipeline; structured pino logging; S3 retry with
backoff; `GET /ingest/:id` and `GET /ingest?limit&offset`.

**Sprint 3 — hardening & Phase 1 exit.** Full failure-mode coverage, parse
classification, and a real readiness probe:

| Input / condition | Behaviour |
|---|---|
| Empty file | `400 EMPTY_FILE` |
| Not X12 at all | stored raw, `UNRECOGNIZED_FORMAT`, no dedup |
| ISA present but unparseable | stored raw, `PARSE_ERROR`, no dedup |
| Oversized (> max size) | `413 FILE_TOO_LARGE` |
| S3 unreachable | `503 STORAGE_UNAVAILABLE`, no DB row |
| DB unreachable | `503 DB_UNAVAILABLE`, **no S3 write** (fail fast) |
| `GET /health` | `200 {status,db,s3}` (or `503` degraded) |

Startup validates required env vars and crashes fast with a clear message if any
are missing. **25 automated tests** (parser, ingestion, failure modes, SFTP).

## Quickstart (local)

```bash
npm install
cp .env.example .env
docker compose up -d            # Postgres + MinIO + SFTP
npm run db:migrate              # raw_files + isa_control_number
npm run dev:api                 # http://localhost:3000

curl -F file=@apps/api/test/fixtures/sample_850.edi http://localhost:3000/ingest/upload
curl http://localhost:3000/ingest
curl http://localhost:3000/health
```

### Try the SFTP channel

```bash
# In .env set: SFTP_WATCH_ENABLED=true   then restart `npm run dev:api`
sftp -P 2222 edi@localhost      # password: edi
> cd incoming
> put apps/api/test/fixtures/sample_850.edi
# Watcher ingests it and moves it to apps/api/.sftp/processed
```

### Run the UI

```bash
# With the API running (npm run dev:api) in another terminal:
npm run dev:web        # http://localhost:5173  (proxies /api -> :3000)
```
Browse transactions, filter by type/partner/status, open a transaction for the
typed view + raw/parsed toggle, and search by PO / invoice / ISA control number.

MinIO console: http://localhost:9001 (minioadmin / minioadmin).

## Verify

```bash
npm run typecheck
npm run lint
npm test                              # parser + api + failures + sftp
npm run smoke --workspace=@edi/api    # live end-to-end (needs docker compose up)
```

## Useful commands

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-check all packages |
| `npm run lint` | ESLint across the repo |
| `npm run db:migrate` | Apply Prisma migrations (dev) |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run dev:api` | Run the API in watch mode |
| `npm run infra:up` / `infra:down` | Start/stop local Postgres + MinIO + SFTP |
