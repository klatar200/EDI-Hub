# EDI Data Hub — Desktop Track Sprint Plan

**For:** Claude Opus 4.8 (build agent)
**Owner:** Keagan
**Prerequisite:** Phases 1–10 (SaaS build) are complete. The codebase has a working Fastify API (`apps/api`), React+Vite frontend (`apps/web`), Prisma + PostgreSQL schema (`packages/db`), S3/MinIO raw file storage, BullMQ job queue, Clerk auth, multi-tenancy, and Phase 10 production readiness work. This plan adds the Desktop Track (D1–D9) on top of that baseline.

**North Star (unchanged):** Transaction lifecycle stitching. This plan is a delivery vehicle change, not a feature change.

---

## HOW TO USE THIS PLAN

**You are Claude Opus 4.8, the build agent.** Read these rules before touching any file.

### Behavioral rules — non-negotiable

1. **Never assume. Never hallucinate a file, function, or library.** Before referencing any file, function, or dependency, use `Read`, `Glob`, or `Grep` to confirm it exists and contains what you think it contains. If you are unsure about something, **stop and ask Keagan** before proceeding.
2. **One sprint at a time.** Complete the sprint in full, run the self-check scorecard, then stop. Do not begin the next sprint without Keagan's go-ahead.
3. **After every sprint, output only:**
   - A one-paragraph summary of what changed.
   - The completed scorecard (items graded ✅ / ❌ / ⚠️ with a sentence on each failure).
   - A list of any **manual tasks** Keagan must perform before the next sprint can start.
   - One question if anything is unclear.
4. **Never delete or overwrite existing passing tests.** Add tests alongside existing ones.
5. **Never change the PostgreSQL schema path (`packages/db/prisma/schema.prisma`) without a migration.** The web/SaaS build must continue to work on Postgres throughout this track.
6. **Raw file is sacred.** The local filesystem adapter must write the raw file to disk before any parse attempt, mirroring the S3 contract.
7. **If a sprint's scorecard has any ❌**, stop. Tell Keagan what failed and wait for resolution before continuing.

---

## PHASE D1 — SQLite Database Adapter (for local dev only)

**Objective:** Make `packages/db` work against both PostgreSQL (production — web/SaaS and desktop installer) and SQLite (local development only, so contributors can run the full stack without installing Postgres). All existing tests must stay green on Postgres. The same test suite must also pass against SQLite.

**Scope clarification:** The packaged desktop installer ships with an embedded Postgres binary (see D4 Sprint 1), not SQLite. SQLite is purely a developer convenience — it eliminates the Docker requirement for local dev so `DATABASE_PROVIDER=sqlite npm run dev` is all that's needed to run the full stack. **Decision: do D1.**

**Context you must read before starting:**
- `packages/db/prisma/schema.prisma` — the full current schema (read it fully)
- `packages/db/src/index.ts` — how the Prisma client is exported
- `packages/db/src/tenant-extension.ts` — the multi-tenant Prisma extension
- `packages/db/src/tenant-context.ts` — the AsyncLocalStorage context
- `packages/db/test/tenant-extension.test.ts` — existing tenant isolation tests

---

### D1 Sprint 1 — Schema audit and provider-portable rewrite

**Goal:** Identify every Postgres-specific attribute in the schema and produce a provider-portable version that compiles for both `postgresql` and `sqlite` providers.

**What to do:**

1. Read `packages/db/prisma/schema.prisma` in full.
2. List every use of:
   - `@db.Uuid` — SQLite has no UUID type; use `String` with app-layer `crypto.randomUUID()`.
   - `Json` / `Jsonb` columns — SQLite stores JSON as TEXT; Prisma's `Json` type maps to TEXT on SQLite but is still queryable as a value, not as JSON path. Confirm this is acceptable (we do not use JSON path queries in v1 — verify by grepping `apps/api/src` for any Prisma query that uses `.path` or `mode: 'insensitive'` on a Json field).
   - `String[]` arrays — PostgreSQL native arrays. **SQLite does not support native arrays.** These must be handled. Options: (a) serialize as JSON string in a `String` column with app-layer parse, or (b) use a junction table. For v1 use JSON string serialization — it is simpler and the arrays are small (`ourIsaIds`, `isaSenderIds`, `isaReceiverIds`, `supportedSets`). Verify every place these fields are read/written in `apps/api/src`.
   - `enum` types — SQLite has no native enum; Prisma maps them to `String` on SQLite automatically. Verify this compiles correctly.
   - `DateTime` with timezone — SQLite stores as TEXT/INTEGER. Prisma maps `DateTime` to ISO-8601 TEXT on SQLite. Confirm this is acceptable.
3. Produce a list of **every change needed** and show it to Keagan for review before writing any code.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S1.1 | Schema audit complete | A written list of all Postgres-specific attributes and their desktop replacements is produced |
| S1.2 | No JSON path queries | Grep of `apps/api/src` confirms zero Prisma queries using `.path` on Json fields |
| S1.3 | Array fields inventoried | Every `String[]` field and every API read/write of those fields is listed |
| S1.4 | Keagan has reviewed and approved the change list | Manual gate — do not proceed without explicit approval |

**⚠️ Stop after scorecard. Show Keagan the audit list and wait for approval.**

---

### D1 Sprint 2 — Dual-provider Prisma schema

**Goal:** Implement the provider-portable schema. SQLite arrays become JSON-serialized strings. Postgres schema remains identical for the SaaS build.

**Prerequisites:** S1.4 approved by Keagan.

**What to do:**

1. Create `packages/db/prisma/schema.sqlite.prisma` — a copy of the main schema with:
   - `datasource db { provider = "sqlite" url = env("DATABASE_URL") }`
   - All `@db.Uuid` removed (keep `String` type, default stays as `@default(uuid())` at the Prisma level — Prisma generates UUIDs for SQLite automatically via `crypto.randomUUID()` in the client).
   - `String[]` fields converted to `String @default("[]")` with a comment noting JSON serialization.
   - `Json` fields left as `Json` (Prisma handles TEXT mapping on SQLite).
   - Enum types left as-is (Prisma maps to String on SQLite).
   - Remove `@db.Timestamptz` if present (it is not in the current schema — confirm).
2. Add an npm script to `packages/db/package.json`:
   - `"db:generate:sqlite": "prisma generate --schema=prisma/schema.sqlite.prisma"`
   - `"db:migrate:sqlite": "prisma migrate dev --schema=prisma/schema.sqlite.prisma"`
3. Create a helper `packages/db/src/client-factory.ts` that reads `DATABASE_PROVIDER` env and returns a Prisma client pointed at the correct schema. The web build always passes `DATABASE_PROVIDER=postgresql`; the desktop build passes `DATABASE_PROVIDER=sqlite`.
4. Update `packages/db/src/index.ts` to export from `client-factory.ts` instead of directly instantiating `PrismaClient`.
5. Write a SQLite-specific migration baseline: `packages/db/prisma/migrations-sqlite/0001_init.sql` generated from `prisma migrate dev` against the SQLite schema on a fresh `.db` file.

**Do not touch `packages/db/prisma/schema.prisma` (the Postgres schema).** It must remain unchanged.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S2.1 | `prisma generate --schema=schema.sqlite.prisma` exits 0 | No TypeScript or schema errors |
| S2.2 | `prisma migrate dev --schema=schema.sqlite.prisma` on a fresh file exits 0 | Migration applies cleanly |
| S2.3 | Postgres schema unchanged | `git diff packages/db/prisma/schema.prisma` is empty |
| S2.4 | `client-factory.ts` switches provider by env | Unit test: set `DATABASE_PROVIDER=sqlite`, confirm client is configured for SQLite |
| S2.5 | Existing Postgres tests still compile | `npm run typecheck --workspace=packages/db` exits 0 |

---

### D1 Sprint 3 — Array field serialization layer

**Goal:** Add a thin serialization/deserialization layer for the `String[]` → `String` (JSON) fields so API code is unchanged.

**Context you must read before starting:**
- `apps/api/src/services/ingestion.ts` — reads/writes `ourIsaIds`, `isaSenderIds`, `isaReceiverIds`
- `apps/api/src/services/partners.ts` — reads partner ISA IDs
- `apps/api/src/routes/partners-config.ts` — creates/updates partners with `supportedSets`
- `packages/db/src/tenant-extension.ts` — the Prisma extension; this is where serialization hooks belong

**What to do:**

1. In `packages/db/src/tenant-extension.ts`, add a Prisma middleware (via `$use` or the extension's `query` hook) that:
   - On **write** (`create`, `update`, `upsert`): for the models and fields listed below, if the value is a JS array, JSON-serialize it to a string before passing to Prisma.
   - On **read** (`findUnique`, `findFirst`, `findMany`): for the same fields, if the value is a string that parses as a JSON array, deserialize it.
   - Fields to handle: `Tenant.ourIsaIds`, `TradingPartner.isaSenderIds`, `TradingPartner.isaReceiverIds`, `TradingPartner.supportedSets`.
   - **Only activate this middleware when `DATABASE_PROVIDER=sqlite`.** When `DATABASE_PROVIDER=postgresql`, the middleware must be a no-op so Postgres behavior is completely unchanged.
2. Write unit tests in `packages/db/test/array-serialization.test.ts` that:
   - With a mock SQLite client: confirm arrays serialize on write and deserialize on read.
   - With a mock Postgres client: confirm no transformation occurs.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S3.1 | Array fields serialize on SQLite writes | Unit test passes: `['123', '456']` → `'["123","456"]'` in DB |
| S3.2 | Array fields deserialize on SQLite reads | Unit test passes: DB string `'["123","456"]'` → `['123', '456']` in JS |
| S3.3 | No-op on Postgres | Unit test passes: Postgres path returns arrays unchanged |
| S3.4 | API services require no changes | Grep `apps/api/src` — no file was modified in this sprint |
| S3.5 | TypeScript compiles | `npm run typecheck --workspace=packages/db` exits 0 |

---

### D1 Sprint 4 — API integration test against SQLite

**Goal:** Run the full API test suite against a SQLite database. Every test that passes on Postgres must also pass on SQLite. Failures reveal remaining incompatibilities to fix.

**Context you must read before starting:**
- `apps/api/test/` — all test files; understand the test runner, database setup/teardown pattern
- `apps/api/src/config.ts` — how DATABASE_URL and other env vars are loaded

**What to do:**

1. Read `apps/api/package.json` to understand the test runner and existing test scripts.
2. Add a test script: `"test:sqlite": "DATABASE_PROVIDER=sqlite DATABASE_URL=file:./test.db <existing-test-command>"`.
3. Run `npm run test:sqlite --workspace=apps/api`. Capture every failure.
4. Fix failures one at a time. Common categories:
   - **UUID format issues** — SQLite returns UUIDs as plain strings; ensure `@db.Uuid` removal does not break `.toString()` comparisons.
   - **Case-insensitive queries** — Postgres `mode: 'insensitive'` is not supported on SQLite. Grep `apps/api/src` for `mode: 'insensitive'` and replace with `{ contains: val }` (SQLite `LIKE` is case-insensitive by default for ASCII).
   - **Full-text search** — if any route uses `_search` or `fullTextSearch`, flag it. Scope to v1: if no FTS is used in the API, confirm and move on.
   - **`now()` / `gen_random_uuid()`** — raw SQL calls. Grep for `$queryRaw` and `$executeRaw`. Replace Postgres functions with SQLite equivalents or move to Prisma abstractions.
5. Do not remove or skip tests. Fix the underlying code.
6. When `test:sqlite` is fully green, confirm `npm test --workspace=apps/api` (Postgres) is still green.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S4.1 | `test:sqlite` exits 0 | All tests pass against SQLite |
| S4.2 | `npm test` (Postgres) exits 0 | All tests still pass against Postgres |
| S4.3 | No tests skipped or deleted | `git diff` shows no test files with removed test cases |
| S4.4 | `DATABASE_PROVIDER=sqlite npm run dev --workspace=apps/api` boots | Server starts and `GET /health` returns 200 |

**⚠️ If S4.1 has failures that require architectural changes (not just query tweaks), stop and show Keagan the list before making structural changes.**

---

## PHASE D2 — Local Job Queue Adapter

**Objective:** Replace BullMQ (Redis-backed) with a Postgres-backed in-process job queue for the desktop installer build. The web/SaaS build continues using BullMQ unchanged. For local dev (SQLite), the same adapter works against a SQLite `jobs` table. The Phase 7 missing-ack detection logic must work identically on both.

**Decision:** Simplicity over complexity. Since the installer already has Postgres running (embedded binary), use a `jobs` table in Postgres instead of a separate Redis/BullMQ dependency. For local dev with SQLite, the same adapter works — Prisma handles the difference. No Redis required anywhere in the desktop track.

**Context you must read before starting:**
- `apps/api/src/services/detection.ts` — the missing-ack detection logic (the job that BullMQ runs)
- `apps/api/src/services/alerts.ts` — how alerts are emitted
- `apps/api/src/index.ts` — how BullMQ workers are registered at startup
- `apps/api/src/config.ts` — how REDIS_URL and queue config are read

---

### D2 Sprint 1 — Job queue interface and database-backed adapter

**Goal:** Define a `JobQueue` interface. Implement a database-backed adapter (Postgres for installer, SQLite for local dev) using a `jobs` table managed by Prisma. The BullMQ adapter wraps the existing logic unchanged.

**What to do:**

1. Create `apps/api/src/jobs/interface.ts`:
   ```typescript
   export interface JobQueue {
     enqueue(jobName: string, payload: unknown, opts?: { delayMs?: number }): Promise<void>;
     shutdown(): Promise<void>;
   }
   export interface JobWorker {
     start(): void;
     shutdown(): Promise<void>;
   }
   ```
2. Add a `Job` model to **both** `packages/db/prisma/schema.prisma` (Postgres) and `packages/db/prisma/schema.sqlite.prisma` (SQLite):
   ```prisma
   model Job {
     id        String   @id @default(uuid())
     name      String
     payload   String   // JSON-serialized
     runAfter  DateTime @map("run_after")
     status    String   @default("pending") // pending | done | failed | dead
     attempts  Int      @default(0)
     error     String?
     createdAt DateTime @default(now()) @map("created_at")

     @@index([status, runAfter])
     @@map("jobs")
   }
   ```
   Add a migration for Postgres: `packages/db/prisma/migrations/<timestamp>_add_jobs_table/migration.sql`. Add the equivalent to the SQLite migration baseline.
3. Create `apps/api/src/jobs/bullmq-adapter.ts` — wraps the existing BullMQ setup into the `JobQueue` / `JobWorker` interface. Move existing BullMQ worker registration code here. Do not change the logic.
4. Create `apps/api/src/jobs/db-adapter.ts`:
   - `enqueue`: INSERT a `Job` row with `status='pending'` and `runAfter = new Date(Date.now() + delayMs)`.
   - A `DbWorker` that `setInterval`-polls every 30 seconds, picks up `status='pending' AND runAfter <= now`, runs the registered handler, updates to `'done'` or `'failed'`.
   - Max 3 retries with exponential backoff before marking `'dead'`.
   - Works against both Postgres and SQLite — Prisma abstracts the difference.
5. Create `apps/api/src/jobs/factory.ts` — reads `JOB_BACKEND` env (`'bullmq'` | `'db'`) and returns the right adapter. Default remains `'bullmq'` so the web/SaaS build is unchanged.
6. Update `apps/api/src/index.ts` to use `factory.ts`.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S5.1 | `Job` model migrates on Postgres | `prisma migrate deploy` exits 0; `jobs` table exists |
| S5.2 | `Job` model migrates on SQLite | SQLite migration baseline includes `jobs` table |
| S5.3 | BullMQ adapter compiles | `npm run typecheck --workspace=apps/api` exits 0 |
| S5.4 | DB adapter unit tests pass | `db-adapter.test.ts`: enqueue → poll → handler called → status `'done'` |
| S5.5 | Retry logic tested | Handler throws twice, succeeds third: `'done'`; throws 3×: `'dead'` |
| S5.6 | Existing API tests still pass | `npm test --workspace=apps/api` exits 0 (BullMQ path unchanged) |

---

### D2 Sprint 2 — Wire detection job into DB adapter

**Goal:** The Phase 7 missing-ack detection job runs correctly via the DB adapter in desktop mode.

**What to do:**

1. Extract the detection job handler into `apps/api/src/jobs/handlers/detection.ts` — a shared handler function used by both the BullMQ adapter and the DB adapter. No duplicated logic.
2. Register the handler in `db-adapter.ts`.
3. Integration test: set `JOB_BACKEND=db`, enqueue a detection job, let the poller tick (use fake timers or a manual tick helper), confirm the detection handler runs and an alert row appears in the DB.
4. Add `.env.desktop.example` with `JOB_BACKEND=db`, `STORAGE_BACKEND=local`, `DATABASE_URL=postgresql://localhost:5433/edihub`.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S6.1 | Detection handler is shared | Single handler function — no duplicated code between adapters |
| S6.2 | Integration test: detection fires on DB adapter | Alert row appears in DB after poller tick |
| S6.3 | BullMQ path unchanged | Existing `detection.test.ts` still passes |
| S6.4 | API boots with `JOB_BACKEND=db` | `JOB_BACKEND=db DATABASE_URL=<postgres-url> npm run dev --workspace=apps/api` boots; `GET /health` returns 200 |

---

## PHASE D3 — Local File Storage Adapter

**Objective:** Replace the S3/MinIO raw file storage with a local filesystem adapter, selected by config. The DB `s3Key` column is repurposed as a generic `storageKey` — for web it is an S3 object key; for desktop it is a relative path under `<dataDir>/raw/`.

**Context you must read before starting:**
- `apps/api/src/storage/s3.ts` — the full S3 adapter (read it)
- `apps/api/src/services/ingestion.ts` — every place `uploadStream`, `getObjectBuffer`, `buildRawFileKey` are called
- `apps/api/src/config.ts` — how S3 config is read

---

### D3 Sprint 1 — Storage interface and local adapter

**Goal:** Add a `StorageAdapter` interface; implement both the S3 adapter and a local filesystem adapter against it.

**What to do:**

1. Create `apps/api/src/storage/interface.ts`:
   ```typescript
   export interface StorageAdapter {
     upload(key: string, body: NodeJS.ReadableStream, contentType?: string): Promise<{ key: string }>;
     download(key: string): Promise<Buffer>;
     buildKey(id: string, ingestedAt?: Date): string;
   }
   ```
2. Wrap `apps/api/src/storage/s3.ts` into `apps/api/src/storage/s3-adapter.ts` implementing `StorageAdapter`. Keep `s3.ts` for backward compat but have it re-export from the adapter.
3. Create `apps/api/src/storage/local-adapter.ts`:
   - `upload`: write stream to `<dataDir>/raw/<key>` using `fs.promises` and `pipeline`. Create parent directories if needed. Return `{ key }`.
   - `download`: read file at `<dataDir>/raw/<key>` and return as Buffer.
   - `buildKey`: same date-partitioned pattern as `buildRawFileKey` in s3.ts (`raw/YYYY/MM/DD/<id>.edi`).
   - `dataDir` comes from config (env var `LOCAL_DATA_DIR`; defaults to `process.env.HOME/.edi-hub/` in local dev).
4. Create `apps/api/src/storage/factory.ts` — reads `STORAGE_BACKEND` env (`'s3'` | `'local'`) and returns the right adapter.
5. Update `apps/api/src/services/ingestion.ts` to use the adapter from the factory instead of calling s3.ts functions directly. Confirm no other files call s3.ts functions — grep and fix any that do.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S7.1 | Local adapter unit tests | `upload` writes file to disk; `download` reads it back; content matches |
| S7.2 | `buildKey` output matches S3 key pattern | Same date-partitioned path as `buildRawFileKey` |
| S7.3 | S3 adapter still passes existing tests | `npm test --workspace=apps/api` exits 0 |
| S7.4 | `STORAGE_BACKEND=local` ingest round-trip | Ingest a real `.edi` fixture → file appears on disk → `GET /raw-files/:id/content` returns original bytes |
| S7.5 | No direct s3.ts calls in `apps/api/src` (except adapter) | Grep confirms |

---

## PHASE D4 — Electron Shell

**Objective:** A new `apps/desktop` package that boots Electron, launches the Fastify API as a child process, and opens a `BrowserWindow` loading the React build. First run of the product as a standalone app.

**Prerequisites:** D1, D2, D3 all complete and their scorecards fully green.

**Context you must read before starting:**
- `apps/api/package.json` — build scripts, entry point
- `apps/web/package.json` — build scripts, output directory
- `apps/web/src/lib/api.ts` — the `BASE` constant (line 26: reads `VITE_API_URL` env or defaults to `/api`)
- `apps/web/src/main.tsx` — app entry, Clerk wiring

---

### D4 Sprint 1 — `apps/desktop` scaffold and API child process

**Goal:** Create the Electron package. Main process boots the Fastify API child and waits for it to be healthy.

**What to do:**

1. Create `apps/desktop/` with:
   - `package.json` with dependencies: `electron`, `electron-builder`, `electron-updater`, and dev-deps `@electron/typescript-definitions`.
   - `tsconfig.json` extending `../../tsconfig.base.json`.
   - `src/main.ts` — Electron main process.
   - `src/preload.ts` — preload script (contextIsolation enabled).
   - `electron-builder.yml` — builder config (placeholder, detailed in D6).
2. In `src/main.ts`, boot in this strict order:
   - **Step 1 — Start embedded Postgres.** Use `embedded-postgres` (`@embedded-postgres/windows`). Extract binary to `<userData>/postgres/` on first run (cached on subsequent runs). Initialize data directory at `<userData>/pgdata/` if it does not exist (`initdb`). Start `postgres` on port 5433. Poll `pg_isready` or attempt a TCP connect every 500ms until ready or 15s timeout. If Postgres fails to start, show an error dialog with the log path and quit.
   - **Step 2 — Run migrations.** After Postgres is ready, run `prisma migrate deploy` against `postgresql://localhost:5433/edihub` using the schema in `resourcesPath/prisma/`. This is idempotent — on subsequent launches it is a no-op if migrations are current.
   - **Step 3 — Start API child.** Spawn the compiled API (`apps/api/dist/src/index.js`) as a child process with env: `DATABASE_URL=postgresql://localhost:5433/edihub`, `STORAGE_BACKEND=local`, `LOCAL_DATA_DIR=<userData>/raw`, `JOB_BACKEND=db`, `PORT=<picked-api-port>`.
   - **Step 4 — Health check API.** Poll `http://127.0.0.1:<api-port>/health` every 500ms until 200 or 10s timeout.
   - **Step 5 — Open BrowserWindow.** Only after the API health check passes.
   - **On quit:** close window → `SIGTERM` API child → wait for exit → stop Postgres cleanly. Never leave orphan processes.
   - If the API child exits unexpectedly after startup, log the error and restart once before showing an error dialog.
3. In `src/preload.ts`:
   - Inject `window.__EDI_API_BASE__` = `http://127.0.0.1:<port>/api` into the renderer context (use `contextBridge.exposeInMainWorld` or a global variable assignment — confirm which is needed for the React app's `fetch` calls).
   - Inject `window.runtime = { mode: 'desktop', version: app.getVersion(), platform: process.platform }`.
4. Update `apps/web/src/lib/api.ts` line 26: change `const BASE = ...` to:
   ```typescript
   const BASE: string =
     (window as unknown as { __EDI_API_BASE__?: string }).__EDI_API_BASE__ ??
     (import.meta.env.VITE_API_URL as string | undefined) ??
     '/api';
   ```
   This is a surgical one-line change. Confirm the web build still works with `VITE_API_URL=/api` or the proxy.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S8.1 | `npm run dev --workspace=apps/desktop` opens Electron window | Window opens without error |
| S8.2 | API child process starts and health-checks pass | Console log shows "API ready on port XXXX" |
| S8.3 | React app loads in window | No blank screen; network tab shows requests to `http://127.0.0.1:<port>/api` |
| S8.4 | Web build unaffected | `npm run dev --workspace=apps/web` still works with Vite proxy; `VITE_API_URL` fallback intact |
| S8.5 | Clean shutdown | Closing the Electron window kills the API child (confirm via process list) |

---

### D4 Sprint 2 — Clerk auth configuration for the LAN server

**Goal:** Confirm the existing Clerk auth integration works correctly for the LAN server context. Users log in via Clerk in their browser using the same accounts that work on the SaaS web app. No new auth code is written — this sprint is configuration and verification only.

**Context:** The SaaS and desktop builds share one Clerk application. A user with a Clerk account on the SaaS product automatically has access to any LAN server install that the same Clerk organization covers. The only new requirement is that Clerk's allowed redirect URIs include the LAN server's address, so the OAuth callback lands on the right machine.

**Context you must read before starting:**
- `apps/api/src/services/auth.ts` — how Clerk tokens are verified
- `apps/api/src/plugins/tenant.ts` — how the tenant context is set from the auth token
- `apps/web/src/components/AuthBridge.tsx` — how Clerk is wired in the frontend
- `apps/web/src/main.tsx` — Clerk provider setup

**What to do:**

1. Read `apps/api/src/services/auth.ts` and `apps/api/src/plugins/tenant.ts` in full. Confirm they have no hardcoded `localhost` or domain assumptions that would break when the API is accessed at `http://<server-ip>:3000`. Fix any that exist.
2. Read `apps/web/src/main.tsx` and `AuthBridge.tsx`. Confirm the Clerk `publishableKey` and `frontendApi` values come from env vars (not hardcoded). They should already be in `.env` — verify.
3. Add `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `.env.desktop.example`. These are the same keys as the SaaS build — one Clerk app, two deployment surfaces.
4. In the Electron main process (`src/main.ts`), pass `VITE_CLERK_PUBLISHABLE_KEY` as an env var to the React build when serving it. The React app reads this at runtime to initialise the Clerk provider.
5. Document the one manual Clerk dashboard step required per customer install: the customer's admin must add `http://<their-server-ip>:3000` (or their internal domain) to Clerk's **Allowed redirect URIs** list in the Clerk dashboard. This is a one-time step per install. Add it as a required step in the first-run wizard (D8 Sprint 2).
6. Smoke test: with the Electron app running and the API on port 3000, open `http://localhost:3000` in a browser. Confirm the Clerk sign-in flow completes and the dashboard loads. Then repeat from a second machine on the same LAN using the server's IP.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S9.1 | No hardcoded domain assumptions in auth code | Read confirms; any found are fixed |
| S9.2 | Clerk keys come from env vars | `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are env-driven in both API and web app |
| S9.3 | Login works on localhost | Browser at `http://localhost:3000` — Clerk flow completes; dashboard loads |
| S9.4 | Login works from LAN | Browser on a second machine at `http://<server-ip>:3000` — Clerk flow completes after redirect URI is added |
| S9.5 | Existing auth tests pass | `apps/api/test/auth.test.ts` exits 0 |
| S9.6 | No schema changes | `git diff packages/db/prisma/schema.prisma` is empty |

**Manual task for Keagan:** In your Clerk dashboard, add `http://localhost:3000` to Allowed redirect URIs for testing. Document this step for customers in the install guide.

---

### D4 Sprint 3 — Cold-start performance and native menus

**Goal:** First launch (double-click → logged-in dashboard, including Postgres initdb) completes with clear progress feedback. Subsequent launches open in under 5 seconds. Native menus with basic app actions.

**Cold-start targets:**
- **First launch:** no time target — `initdb` alone can take 30–90 seconds. Show a progress screen with a step-by-step status log and an estimated timeframe ("This only happens once and usually takes under 2 minutes").
- **Subsequent launches:** ≤ 5 seconds from double-click to dashboard.

**What to do:**

1. Measure subsequent cold-start time: `Date.now()` at app launch vs. when the BrowserWindow `did-finish-load` fires on a second launch. Log it.
2. If over 5 seconds on subsequent launches, profile — the bottleneck is usually API startup. Pre-compile the API to a single bundled file with `esbuild` to reduce `require()` time.
3. Add a loading splash screen (`apps/desktop/src/splash.html`) that shows:
   - On first launch: a step-by-step progress list ("Setting up database... ✓", "Running migrations...", "Starting server...") with a note that this is a one-time setup.
   - On subsequent launches: a simple spinner that disappears quickly.
   Replace the splash with the React app once the API health check passes.
4. Add a native application menu (`apps/desktop/src/menu.ts`):
   - **File:** Quit
   - **Edit:** standard copy/paste/undo (use `Menu.buildFromTemplate` with `role` items)
   - **Help:** About (shows version), Open Logs Folder, Check for Updates (stub for D7)

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S10.1 | Subsequent cold-start ≤ 5 seconds | Measured on second launch (log the ms); passes threshold |
| S10.1b | First launch shows step-by-step progress | Splash lists each boot step with status; "one-time setup" message visible |
| S10.2 | Splash screen shows during API startup | Visible progress before dashboard appears |
| S10.3 | Native menus present | All menu items render; Quit works; About shows version |
| S10.4 | No console errors in renderer | DevTools console is clean after dashboard loads |

**Manual task for Keagan:** After S10 completes, test the app on your actual machine. Report cold-start time and any UI issues before D5 begins.

---

## PHASE D5 — UI Parity Harness

**Objective:** Lock UI parity between the web build and the desktop build in CI. Any pixel drift in the three critical flows fails the build.

**Context you must read before starting:**
- `apps/web/src/pages/TransactionsPage.tsx` — transaction list
- `apps/web/src/pages/LifecyclePage.tsx` — lifecycle view
- `apps/web/src/pages/AlertsPage.tsx` — alert acknowledgment

---

### D5 Sprint 1 — Playwright parity tests

**Goal:** Three Playwright tests that run the same scripted user flow against both web and desktop builds and compare screenshots.

**What to do:**

1. Add Playwright to the repo: `npm install -D @playwright/test` at the root.
2. Create `apps/desktop/test/parity/` with three test files:
   - `transaction-list.spec.ts` — navigate to `/`, confirm the transaction table renders with at least the column headers.
   - `lifecycle-view.spec.ts` — navigate to `/lifecycle`, enter a PO number from the test fixture, confirm the lifecycle timeline renders.
   - `alert-ack.spec.ts` — navigate to `/alerts`, confirm the alerts list renders.
3. Each test runs against:
   - The web build: `http://localhost:5173` (Vite dev server)
   - The desktop build: Electron via `playwright-electron` or by pointing Playwright at the Electron renderer URL
4. Screenshot both, diff them. Fail if pixel difference > 0.5% of total pixels (use `pixelmatch` or Playwright's built-in `toHaveScreenshot`).
5. Add a GitHub Actions step in `.github/workflows/ci.yml` that runs these tests on every push.

**Note:** If `playwright-electron` is not compatible with the current Electron version, do a visual diff only on the web build (Playwright against Vite) and a functional check (non-visual) on Electron. **Do not guess about compatibility — check the Playwright docs and the installed Electron version before writing the tests.**

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S11.1 | Transaction list test passes on web | Screenshot matches baseline; no pixel diff above threshold |
| S11.2 | Lifecycle view test passes on web | Screenshot matches baseline |
| S11.3 | Alert list test passes on web | Screenshot matches baseline |
| S11.4 | CI step added | `ci.yml` includes the parity test step |
| S11.5 | Baseline screenshots committed | `test/parity/__screenshots__/` directory committed to the repo |

---

## PHASE D6 — Installer and Code Signing

**Objective:** `npm run dist` produces a signed, distributable Windows installer from the CI build. A non-developer can download, install, and launch on a clean Windows machine. (macOS out of scope for v1.)

**⚠️ This phase has significant calendar dependencies (cert procurement). Start the manual tasks on day one of this phase, not at the end.**

---

### D6 Sprint 1 — `electron-builder` config and unsigned builds

**Goal:** `npm run dist` produces unsigned installers for all target platforms. Verify the installers install and launch correctly before dealing with signing.

**What to do:**

1. Complete `apps/desktop/electron-builder.yml`:
   ```yaml
   appId: com.edihub.desktop
   productName: EDI Hub
   directories:
     output: dist-installer
   files:
     - apps/desktop/dist/**/*
     - apps/api/dist/**/*
     - node_modules/**/*   # only production deps — see electron-builder docs
   win:
     target: nsis
   # macOS: out of scope for v1.
   # Linux: deferred to post-v1. Add AppImage target when first customer requests it.
   extraResources:
     - from: apps/api/dist
       to: api
     - from: packages/db/prisma/schema.prisma
       to: prisma
     - from: packages/db/prisma/migrations
       to: prisma/migrations
   ```
2. Update `apps/desktop/src/main.ts` to locate the bundled API in `process.resourcesPath` when running as a packaged app (vs. `../../apps/api/dist` in dev mode). Add a `app.isPackaged` branch.
3. Add `"dist": "electron-builder build"` to `apps/desktop/package.json`.
4. Build and test on the current OS. Verify:
   - Install completes without errors.
   - App launches; API child starts; login screen appears.
   - Uninstall is clean.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S12.1 | `npm run dist` exits 0 | Installer artifact produced |
| S12.2 | Unsigned installer installs on current OS | Install completes without OS errors |
| S12.3 | App launches from install | Login screen appears; no crash |
| S12.4 | `app.isPackaged` branch works | API child found in `resourcesPath` |

**Manual task for Keagan (start immediately):**
- **Windows:** Purchase an EV code-signing certificate (DigiCert, Sectigo, or SSL.com). Delivery takes 1–5 business days after identity verification. ~$300–600/year plus a hardware USB token. macOS signing is not needed — v1 is Windows-only.

---

### D6 Sprint 2 — Code signing integration

**Prerequisites:** Keagan has completed cert procurement and provided signing credentials as GitHub Actions secrets.

**What to do:**

1. Add signing config to `electron-builder.yml`:
   - **Windows:** `win.certificateFile` pointing to the EV cert PFX, passphrase from env.
   2. Create `.github/workflows/release.yml`:
   - Triggers on `git tag v*`.
   - Builds on `windows-latest` (Windows NSIS installer only — macOS is out of scope for v1).
   - Uploads signed artifact to GitHub Releases.
   - Runs only on tags — not on every push.
3. Tag a test release (`v0.0.1-alpha`), let the workflow run, download the signed artifact, and verify:
   - Windows: install completes with no SmartScreen warning.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S13.1 | GitHub Actions release workflow runs on tag | Workflow completes on `v0.0.1-alpha` tag |
| S13.2 | Windows installer is signed | No SmartScreen warning on a clean Windows machine |
| S13.3 | Artifact on GitHub Releases | `.exe` visible in the release |

**Manual task for Keagan:** Install the signed Windows build on a machine that has never run the app. Confirm it launches cleanly.

---

## PHASE D7 — Auto-Update

**Objective:** Installed copies of the app detect, download, and apply updates on next launch.

---

### D7 Sprint 1 — `electron-updater` integration

**Decided:** Updates are **silent** — they download in the background and apply on next launch. No prompt before download. After relaunch into the new version, show a "What's new in vX.Y.Z" dialog (one time only, keyed by version in `<userData>/config.json`).

**What to do:**

1. Add `electron-updater` to `apps/desktop/package.json` (it may already be present from D4 — check).
2. In `apps/desktop/src/main.ts`, add the auto-update flow:
   ```typescript
   import { autoUpdater } from 'electron-updater';
   autoUpdater.autoDownload = true;       // silent download
   autoUpdater.autoInstallOnAppQuit = true; // apply on next quit/relaunch
   // On app ready (after window is shown):
   autoUpdater.checkForUpdates();
   autoUpdater.on('update-downloaded', (info) => {
     // Store the new version in config so we can show "What's new" after relaunch.
     writeConfig({ pendingWhatsNew: info.version });
   });
   ```
3. On app start, check `config.pendingWhatsNew`. If set and matches `app.getVersion()`, show a "What's new" dialog then clear the flag.
4. Configure `electron-builder.yml` to point `publish` at GitHub Releases:
   ```yaml
   publish:
     provider: github
     owner: klatar200
     repo: EDI-Hub
   ```
5. Add a "Check for Updates" menu item (wired to `autoUpdater.checkForUpdates()` with a toast on completion).
6. Test: publish `v0.0.2-alpha`. Open the `v0.0.1-alpha` install. Confirm the update downloads silently and the "What's new" dialog appears after relaunch.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S14.1 | Update downloads silently | No prompt; `update-downloaded` event fires in background |
| S14.2 | Update applies on relaunch | App restarts into the new version |
| S14.3 | "What's new" dialog shows once | Dialog appears after first launch into new version; not on subsequent launches |
| S14.4 | "Check for Updates" menu item works | Manual trigger finds update and downloads it |
| S14.5 | No update available → silent | If on latest version, no dialog appears |

---

## PHASE D8 — Licensing and First-Run Experience

**Objective:** Make the app sellable. 14-day trial, license key entry, offline key validation, and a first-run wizard that gets a new customer ingesting their first file without documentation.

---

### D8 Sprint 1 — Trial counter and license key validation

**Goal:** The app is unusable after 14 days without a license key. License keys are Ed25519-signed payloads validated offline.

**What to do:**

1. Store the first-launch date in `<userData>/license.json`. On every app start, check `(now - firstLaunch) > 14 days`. If over 14 days and no valid key, show a blocking "License required" screen.
2. License key format: base64url-encoded JSON `{ customerId, renewsAt, tier }` signed with your Ed25519 private key. `renewsAt` is the annual renewal date (ISO-8601). The desktop app ships the corresponding public key hardcoded. Validation: decode → verify signature → check `renewsAt`. The app warns the user 30 days before `renewsAt` ("Your license renews on X — please contact support to renew") and blocks 7 days after `renewsAt` with the same "License required" screen as the expired trial.
3. Add a "Enter License Key" screen accessible from the blocking screen and from Help menu.
4. On valid key entry: write key to `license.json`, unlock the app.
5. **Fail open:** if the license check itself errors (I/O failure, clock issues), log the error and allow the app to run. Never let a license bug lock out a paying customer.
6. The Ed25519 keypair is generated by you (Keagan) offline. The private key is yours; the public key is embedded in the app. **Do not commit the private key.**

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S15.1 | Trial runs for 14 days | Mocked first-launch 13 days ago → app opens normally |
| S15.2 | Trial blocks at day 15 | Mocked first-launch 15 days ago, no key → blocking screen shown |
| S15.3 | Valid key unlocks app | Generated key with test private key → app opens |
| S15.4 | Invalid key rejected | Tampered key → error message; blocking screen stays |
| S15.5 | Renewal warning shown at 30 days | Mocked `renewsAt` 29 days away → warning banner visible on dashboard |
| S15.5b | App blocks 7 days past `renewsAt` | Mocked `renewsAt` 8 days ago, no renewed key → blocking screen shown |
| S15.6 | Fail-open on I/O error | Delete `userData` directory mid-run → app opens with a warning, not a crash |

**Manual task for Keagan:** Generate the Ed25519 keypair (`node -e "const {generateKeyPairSync} = require('crypto'); const {privateKey, publicKey} = generateKeyPairSync('ed25519'); console.log(privateKey.export({type:'pkcs8',format:'pem'})); console.log(publicKey.export({type:'spki',format:'pem'}))"`) and store the private key somewhere safe (password manager). Provide the public key PEM string to the agent for embedding.

---

### D8 Sprint 2 — First-run wizard

**Goal:** A new customer who has never used the product can install, complete the wizard, and see their first ingested EDI file in the dashboard — with zero support.

**What to do:**

1. After the first admin logs in via Clerk, check a `firstRunComplete` flag in the API config (`<userData>/config.json`). If not set, show a 5-step wizard. This is a standard web-based flow — it works whether the user is in the Electron window or a LAN browser. **Do not gate on `window.runtime` — the wizard must work for both.**
   - **Step 1 — Welcome:** product name, brief description of what the hub does. "Let's get your first file in."
   - **Step 2 — Clerk redirect URI:** display the server's address (fetched from `GET /api/health` which returns the bound host/port) and instruct the admin to add it to Clerk's Allowed redirect URIs. Show a link to the Clerk dashboard. Include a "I've done this" button that does a quick Clerk auth round-trip to verify it works before allowing the wizard to proceed.
   - **Step 3 — Drop Folder:** display the current drop folder path (set by the Electron main process in config, or manually entered if accessing via LAN browser). If in the Electron window, use the native folder picker via IPC. If in a LAN browser, show a text input for the server-side path. Store in `<userData>/config.json`.
   - **Step 4 — Trading Partner:** minimal partner form (display name, ISA sender ID). Maps to the `POST /partners-config` endpoint. Pre-fill with placeholder text.
   - **Step 5 — Telemetry consent:** "Help us improve EDI Hub by sending anonymous crash reports?" with Yes / No buttons. Store the choice as `telemetryEnabled: boolean` in `<userData>/config.json`. **No telemetry is sent before this step is answered.**
2. After wizard completion: set `firstRunComplete=true` in config, redirect to the dashboard, and start the drop-folder watcher on the chosen folder.
3. Show a persistent banner "Drop an EDI file into `<folder>` to ingest it" until the first file is ingested.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S16.1 | Wizard shows on first login | Fresh `<userData>` → wizard appears after first admin Clerk login |
| S16.2 | Wizard works in both Electron and LAN browser | Tested in Electron window and in Chrome on a second machine |
| S16.3 | Clerk redirect URI step verifies successfully | "I've done this" button confirms Clerk auth round-trip works |
| S16.4 | Folder picker works in Electron | Native picker opens; path saved to config |
| S16.5 | Folder path text input works in LAN browser | Manual path entry saved; watcher starts on that path |
| S16.6 | Partner created via wizard | Step 4 submits; partner appears in `/partners-config` |
| S16.7 | Drop folder watcher starts after wizard | Copy a `.edi` file into the selected folder; it ingests |
| S16.8 | Telemetry step captured | Yes → `telemetryEnabled=true`; No → `false` |
| S16.9 | No telemetry before consent step | Network monitor: zero outbound Sentry requests before Step 5 |
| S16.10 | Wizard does not re-appear | Relaunch after completion → dashboard directly |
| S16.11 | Banner disappears after first ingest | Ingest a file → banner gone |

---

## PHASE D9 — Backup/Restore and Crash Reporting

**Objective:** Make the app survivable in a customer's hands. One-click backup, restore-from-backup on a different machine, and opt-in crash reporting.

---

### D9 Sprint 1 — Backup and restore

**Goal:** A user can export a backup ZIP and restore it on a different machine, recovering their complete data.

**What to do:**

1. Add a "Export Backup" item to the Help menu (or a dedicated Settings page).
2. Backup action:
   - Stop the API child (Postgres stays running — backup reads directly from it).
   - Run `pg_dump -Fc -d edihub -h localhost -p 5433 -f <userData>/backup.pgdump` using the bundled Postgres `pg_dump` binary from `<userData>/postgres/bin/`.
   - Use `archiver` (npm package) to zip `<userData>/backup.pgdump` + `<userData>/raw/` into a timestamped file `edi-hub-backup-YYYYMMDD-HHmmss.zip`. Show a native save dialog.
   - Restart the API child after the dump completes.
3. Add a "Restore from Backup" item. Action:
   - Show a file picker (`.zip` files only).
   - Confirm dialog: "This will replace all current data. Are you sure?"
   - Stop the API child.
   - Unzip the archive to a temp directory.
   - Run `pg_restore -d edihub -h localhost -p 5433 --clean --if-exists <tempdir>/backup.pgdump` using the bundled binary.
   - Copy `<tempdir>/raw/` to `<userData>/raw/`, overwriting existing files.
   - Restart the API child and reload the BrowserWindow.
4. Write a test that: exports a backup, drops and recreates the `edihub` database, restores the backup, and confirms a known transaction row and a raw file are intact.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S17.1 | Backup creates a valid ZIP | ZIP contains `backup.pgdump` and `raw/` directory |
| S17.2 | Restore from backup on same machine | After restore, previously ingested transaction is visible in UI |
| S17.3 | Restore on fresh machine | Copy backup ZIP to a machine with a fresh install → restore → data visible |
| S17.4 | Restore while app is running | API stops, restore completes, API restarts, UI reloads |

**Manual task for Keagan:** Perform the cross-machine restore test manually. Take the backup ZIP from your dev machine, restore it on a second machine (or a fresh VM), and confirm transactions are visible.

---

### D9 Sprint 2 — Crash reporting and diagnostic bundle

**Goal:** Wire Sentry crash reporting to the consent captured in the first-run wizard (D8 Sprint 2 Step 4). One-click "Export Diagnostic Bundle" for support use.

**What to do:**

1. Add `@sentry/electron` to `apps/desktop/package.json`.
2. In `apps/desktop/src/main.ts`, on startup read `config.telemetryEnabled`. Initialize Sentry only if `true`. The user already gave consent (or declined) in the first-run wizard — do not ask again here. A "Change privacy settings" option in Help menu re-opens the consent screen and updates the config.
3. Add a "Export Diagnostic Bundle" to the Help menu. Action: zip together:
   - Last 500 lines of the API child process log (write API stdout/stderr to `<userData>/logs/api.log` on a rolling basis)
   - The Electron main process log (`app.getPath('logs')`)
   - App version, OS, Node version, Electron version
   - `<userData>/config.json` (strip any license key fields)
   - **Not** the database or raw EDI files (too large and sensitive)
4. Show a native save dialog for the diagnostic bundle.

**Exit criteria (scorecard):**

| # | Check | Pass condition |
|---|---|---|
| S18.1 | Sentry off by default | Fresh install: no outbound Sentry requests (confirm via network monitor) |
| S18.2 | Opt-in activates Sentry | Set `TELEMETRY_ENABLED=true` → crash triggers Sentry event |
| S18.3 | Diagnostic bundle exports | ZIP contains all required files, no DB or raw EDI files |
| S18.4 | API logs written to disk | `<userData>/logs/api.log` contains API output after use |

---

## PHASE SUMMARY

| Phase | Sprints | What it proves |
|---|---|---|
| D1 | S1–S4 | API and DB run against SQLite; all tests green on both providers |
| D2 | S5–S6 | Missing-ack detection runs without Redis/BullMQ |
| D3 | S7 | Raw file ingest/download works from local disk |
| D4 | S8–S10 | Standalone Electron app opens; login works; subsequent launch ≤ 5s |
| D5 | S11 | UI parity locked in CI |
| D6 | S12–S13 | Signed installers produced from CI |
| D7 | S14 | Installs auto-update |
| D8 | S15–S16 | License gating and first-run wizard complete |
| D9 | S17–S18 | Backup/restore and crash reporting |

**Total sprints: 18**

---

## OPTIONAL SPRINTS (polish — not blocking)

Deferred cleanup items surfaced during D7 auto-update verification. Schedule
these when log noise or polish matters more than the next feature phase. None
block D8–D9 or selling the desktop SKU.

### OPTIONAL-D1 — Desktop boot log noise cleanup

**Objective:** Remove scary-but-harmless warnings from packaged Windows installs
so support logs are easier to read.

**Scope:**

| Item | Fix |
|---|---|
| `EPERM: chmod postgres.exe` under `Program Files` | Catch and ignore in `main.ts` — Windows cannot chmod binaries in a per-machine install path; Postgres still starts. |
| `database "edihub" already exists` logged as ERROR | Treat as expected on relaunch in `ensureDatabase()`; downgrade to debug or swallow the known message. |
| `disableWebInstaller is set to false` | Already fixed in v0.0.6-alpha (`autoUpdater.disableWebInstaller = true`); verify on current release only. |
| Clerk development-keys warning in release builds | Release workflow bakes `VITE_CLERK_PUBLISHABLE_KEY`; switch to **production** Clerk keys (`pk_live_…`) before selling and document in `CLERK_SETUP.md`. |

**Exit criteria:**

| # | Check | Pass condition |
|---|---|---|
| OD1.1 | No EPERM unhandled rejection on packaged Windows launch | Launch with `--enable-logging`; no `UnhandledPromiseRejectionWarning` for chmod |
| OD1.2 | No ERROR line for existing database on relaunch | Second launch logs clean Postgres boot |
| OD1.3 | No disableWebInstaller warning | Absent on v0.0.6+ installs |
| OD1.4 | Production Clerk key documented | `CLERK_SETUP.md` or desktop README notes live-key requirement for shipped builds |

**Effort:** ~0.5 sprint (small, focused diff).

---

## OPEN QUESTIONS — ANSWERED

| # | Question | Answer |
|---|---|---|
| OQ1 | One desktop SKU (workstation only) or also a "small server" variant for LAN access? | **LAN server variant.** App installs on a server; multiple users access via browser on the LAN. Requires real Postgres, real multi-user auth, and RBAC. See D4 Sprint 2 updates below. |
| OQ2 | Annual subscription or one-time perpetual license? | **Annual subscription.** License key payload must include `renewsAt` (the annual renewal date). The app warns 30 days before expiry and blocks 7 days after. |
| OQ3 | Auto-update: opt-in prompt or silent? | **Silent.** Updates download and apply on next launch with no user prompt. A "What's new" dialog appears after the update is applied. |
| OQ4 | Telemetry: opt-in on first run (wizard step) or off with no prompt? | **Opt-in on first run.** The first-run wizard includes a step asking for consent before any telemetry is sent. |
| OQ5 | Linux AppImage for v1? | **No.** Skip Linux for v1. Add after the first paying desktop customer requests it. Remove the `linux` target from `electron-builder.yml`. |

### Implications of OQ1 (LAN server variant) on the sprint plan

The LAN server decision changes D4 Sprint 2 significantly. Instead of a single local user with bcrypt auth, the app must support multiple users accessing the hub over the network. Concretely:

- **Keep Postgres** as the database for the server install. SQLite (D1) remains useful for developer local testing and may power a future single-workstation lite SKU, but the LAN server variant ships with Postgres. D1 is still worth completing because it makes local dev faster and validates provider-portability, but the **packaged installer bundles Postgres** (via an embedded `pg` binary or a Docker Compose file) rather than SQLite.
- **Auth:** Use Clerk — it is already wired up, and keeping it means the desktop and SaaS builds stay in sync with zero extra auth code. Cost is not a concern: Clerk's free tier covers 50,000 monthly retained users and 100 monthly retained organizations at $0/month. Each desktop customer is one organization with a handful of internal users, so you will realistically never leave the free tier. If you ever exceed 100 active customer orgs in a month, the overage is $1/month per org — negligible at that scale.
- **Electron role shifts:** The Electron shell becomes a server launcher and admin console, not the primary UI. Regular users access the hub via their browser at `http://<server-ip>:3000`. The Electron app runs on the server machine and provides: (1) a tray icon showing server status, (2) a local admin console for starting/stopping the server, viewing logs, and triggering backups, (3) the installer/updater.
- **Multi-user RBAC:** Already implemented in the SaaS build (Phase 9). Reuse it directly.
- **Backup/restore (D9):** The backup must include the Postgres dump (`pg_dump`), not just a SQLite file. The restore procedure is `pg_restore` on the target machine.

**DB decision locked: bundled Postgres binary.** Use the `embedded-postgres` npm package (`@embedded-postgres/windows` for v1). On first launch, the main process extracts the Postgres binary to `<userData>/postgres/`, initializes a data directory at `<userData>/pgdata/`, and starts `postgres` as a child process on a fixed local port (e.g. 5433, avoiding collision with any system Postgres). The API child then connects to it via `DATABASE_URL=postgresql://localhost:5433/edihub`. From the user's perspective: one installer, one click, everything running. No Docker, no separate installs, no IT intervention required. The Electron main process is responsible for starting Postgres before the API, health-checking it, and shutting it down cleanly on quit — in the order: start Postgres → wait for ready → start API → wait for ready → open window. On quit: close window → stop API → stop Postgres.

---

## WHAT KEAGAN MUST DO BEFORE CODING STARTS

1. Confirm the current branch is clean and `npm test` is fully green on Postgres.
2. Confirm `apps/api` and `apps/web` both run locally in dev mode without errors.
3. In the Clerk dashboard, add `http://localhost:3000` to Allowed redirect URIs now (for D4 Sprint 2 testing). Customer-specific IPs are added per install via the first-run wizard.
4. Order the EV code-signing certificate (Windows) the day Phase D6 begins — not at the end of D6. macOS signing is not needed for v1.
5. Generate the Ed25519 keypair before D8 Sprint 1 (command in that sprint). Store the private key in a password manager. Never commit it.
