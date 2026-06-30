# Local development — zero cost

**Active track** until go-live. No AWS, no domain, no Terraform apply.

**AI builder rules (scope, cost policy, CLI):** [`AGENTS.md`](../AGENTS.md) · **What's next:** [`BUILD_PLAN.md`](../BUILD_PLAN.md)

Everything below runs on your machine using **Docker Desktop** (free for personal use) and **Node.js**.

---

## Prerequisites

| Tool | Cost | Install (PowerShell) |
|------|------|----------------------|
| Node.js 20+ | Free | https://nodejs.org or `winget install OpenJS.NodeJS.LTS` |
| Docker Desktop | Free (personal) | https://www.docker.com/products/docker-desktop/ |
| Git | Free | `winget install Git.Git` |

Optional: **Clerk** free account for real sign-in (or skip — API has dev-fallback without keys).

---

## One-time setup

From repo root in VS Code terminal (**PowerShell**):

```powershell
npm install
Copy-Item .env.example .env
notepad .env
```

`.env` defaults already point at local Postgres + MinIO. For quickest start you can leave Clerk keys as-is or blank (dev-fallback pins the pilot tenant).

Start infrastructure:

```powershell
docker compose up -d
npm run db:migrate
```

Services:

| Service | URL | Credentials |
|---------|-----|-------------|
| Web (Vite) | http://localhost:5173 | — |
| API | http://localhost:3000 | — |
| Postgres | localhost:5432 | `edi` / `edi` / db `edi_hub` |
| MinIO API | http://localhost:9000 | `minioadmin` / `minioadmin` |
| MinIO console | http://localhost:9001 | same |

---

## Daily dev loop

Terminal 1:

```powershell
npm run dev:api
```

Terminal 2:

```powershell
npm run dev:web
```

Open http://localhost:5173

---

## Ingest test EDI

```powershell
# Full stack validation (Postgres + MinIO + migrate + ingest + lifecycle + detection):
npm run validate:local

# Or upload only (API must be running):
curl.exe -F "file=@apps/api/test/fixtures/sample_850.edi" http://localhost:3000/ingest/upload
curl.exe http://localhost:3000/health
```

Browse lifecycles, search, alerts — full hub against local Postgres + MinIO.

---

## SFTP channel (optional, still local)

In `.env`:

```env
SFTP_WATCH_ENABLED=true
```

Restart API, then:

```powershell
sftp -P 2222 edi@localhost
# password: edi
# put sample.edi into incoming/
```

---

## Clerk (optional — free tier)

1. https://clerk.com → create app **EDI Data Hub (dev)**
2. Copy `pk_test_...` and `sk_test_...` into `.env`
3. For webhooks locally, use ngrok only if you need org sync — not required for basic UI testing

**Organizations (multi-tenant):** Clerk **Hobby** ($25/mo) is a **go-live** concern. Local dev can use dev-fallback or a single test org on Free tier.

Attach pilot data after creating an org:

```powershell
npm run attach-pilot-org --workspace=@edi/api -- org_xxxxxxxx
```

---

## Verify before commit

```powershell
npm run test:ci
```

Live smoke (needs Docker + migrated DB):

```powershell
npm run smoke --workspace=@edi/api
```

---

## Responsive UI checklist (UR6 / R37)

After layout or breakpoint changes, resize the hub through these widths and spot-check chrome + one list + one detail page. Use the browser devtools device toolbar or drag the window edge.

| Width | Breakpoint | What to verify |
|-------|------------|----------------|
| **375px** | Mobile | Hamburger nav opens; filters collapse to **Filters** popover; list pages show **cards** not tables; toasts span full width |
| **768px** | Tablet | Header wraps cleanly; filter toolbar still usable; cards below `lg` |
| **1280px** | Laptop | Horizontal top nav; **tables** with sticky header; command palette centered |
| **1920px** | Ultra-wide | **Left sidebar** nav (`2xl+`); lifecycle detail **summary panel**; dashboard stat grid uses full width |

Press **`?`** (or the **?** button in the header) for keyboard shortcuts — **`/`** focuses search, **`Ctrl+K` / `⌘K`** opens the command palette.

**Pages to exercise manually**

1. **Layout** — `/documents` (header: search, alerts bell, org switcher)
2. **Table/list** — `/documents?view=parsed` or `/lifecycles` (cards vs table flip at 1024px)
3. **Detail** — `/lifecycle/<po>` (timeline + side panel at 1920px)
4. **Forms** — `/partners-config` editor grids stack on narrow widths

**Automated parity (R36)** — Playwright snapshots at the same four widths (requires Clerk session — see [`.auth/README.md`](../.auth/README.md)):

```powershell
npm run test:parity:responsive
# After an intentional visual change:
npm run test:parity:responsive:update
```

CI runs the full parity suite (including responsive matrix) when `CLERK_PARITY_STATE_B64` is configured.

---

## What you are NOT doing (until go-live)

- `terraform apply` / AWS RDS / S3 / ALB / ECS
- Route 53 domain registration
- Paid Clerk production keys
- Staging deploy — see [`BUILD_PLAN.md`](../BUILD_PLAN.md) §4 (deferred)

When ready for production, say so explicitly — agents will then walk through [`infra/WINDOWS.md`](../infra/WINDOWS.md) with cost expectations.

---

## Stop / reset

```powershell
npm run infra:down          # stop Docker services
docker compose down -v      # + delete volumes (wipes local DB)
```
