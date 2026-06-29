# Local validation runbook

How to prove the ingestion pipeline works on your machine — from a zero-dependency
SQLite check up to the full Docker stack and a browser walkthrough.

Three levels, fastest first. Level 1 needs **no Docker**; Levels 2–3 use Docker Desktop.

---

## Level 1 — No-Docker pipeline proof (SQLite + local files)

Proves the real ingest → parse → lifecycle-stitch → detection loop without any
infrastructure. This is what runs in CI-adjacent dev and what the desktop SKU uses.

### 1a. DB-layer round-trip

```powershell
npm run smoke:sqlite --workspace=@edi/api
```

Expected: `[smoke:sqlite] all 10 round-trip checks PASSED` (tenant isolation, array
serialization, enums, audit all verified on real SQLite).

### 1b. End-to-end ingestion loop (the North Star)

Ingests the synthetic `Test Files/lifecycles/PO-10001/` set
(`850 → 855 → 856 → 810 → 997`) and asserts all five documents stitch into one PO.

```powershell
# 1. Generate the SQLite client + a fresh DB file
npm run db:generate:sqlite --workspace=@edi/db
$env:DATABASE_URL = "file:./e2e.sqlite"
npm run db:migrate:sqlite --workspace=@edi/db

# 2. Run the loop (Clerk keys empty -> dev-fallback admin; local file storage)
$env:DATABASE_PROVIDER = "sqlite"
$env:STORAGE_BACKEND   = "local"
$env:LOCAL_DATA_DIR    = "./.e2e-data"
$env:CLERK_SECRET_KEY  = ""
npx tsx apps/api/test/smoke-ingest-local.ts
```

Expected tail:

```
[2] lifecycle PO-10001: 9 events — sets [810, 850, 855, 856, 997]
[3] all five documents stitched into one PO conversation
[4] detection pass OK (1 tenant(s))
NO-DOCKER INGESTION LOOP PASSED
```

> Verified passing in this form. If you change the fixtures, keep the ISA pairing
> (`VENDOR01` → `EDIHUB`, with the 997 reversed) so direction resolves.

---

## Level 2 — Full stack (Docker Postgres + MinIO)

This is the real SaaS-shaped stack and the official `validate:local` exit criterion.

```powershell
docker compose up -d            # Postgres + MinIO
npm run validate:local          # probes ports, migrates, runs the ingest smoke
```

Expected: `validate:local — all checks passed`.

`validate:local` runs `apps/api/test/smoke-local.ts`, which uploads a sample 850 via
`POST /api/ingest/upload`, verifies it lands in MinIO + Postgres as `PARSED`, confirms
the lifecycle row, and runs a detection pass.

---

## Level 3 — Browser walkthrough (the human loop)

With the Docker stack up (Level 2):

```powershell
npm run dev:api                 # terminal 1  -> http://localhost:3000
npm run dev:web                 # terminal 2  -> http://localhost:5173
```

Then, in the browser:

1. **Sign in** (Clerk, or dev-fallback if Clerk keys are blank).
2. On the empty **Lifecycles** homepage you should see the **onboarding checklist** —
   step 1 *Add a trading partner*, step 2 *Ingest your first file*.
3. **Partners** → add a partner whose ISA sender ID matches the fixtures (`VENDOR01`).
4. **Settings → EDI identity** → add your own ISA ID (`EDIHUB`) so inbound/outbound
   classification works.
5. **Ingest** the synthetic lifecycle — either upload each file from
   `Test Files/lifecycles/PO-10001/` on the Ingestions page, or drop them into the
   configured SFTP/drop folder.
6. Back on **Lifecycles**, open `PO-10001`: the timeline should show the 850, 855, 856,
   810, and the 997 in chronological order, each with a status indicator.

---

## Notes & gotchas found during validation

- **Use synthetic fixtures, not `reference/`.** `Test Files/lifecycles/` is synthetic
  (safe to re-ingest); `Test Files/reference/` holds real partner POs — keep those out
  of routine testing per the data-rights guidance.
- **Dedup is per-tenant by ISA control number.** Re-ingesting the same file is a no-op
  (`DUPLICATE`), by design. Change the ISA control number to force a re-ingest.
- **`db push` does not seed the pilot tenant.** The Postgres migration seeds it; the
  SQLite `db push` path does not, so the Level-1b script creates it itself.
