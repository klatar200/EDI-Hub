# Local development — zero cost

**Active track** until go-live. No AWS, no domain, no Terraform apply.

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

## What you are NOT doing (until go-live)

- `terraform apply` / AWS RDS / S3 / ALB / ECS
- Route 53 domain registration
- Paid Clerk production keys
- Staging deploy — see [`BUILD_PLAN.md`](../BUILD_PLAN.md) §9 (deferred)

When ready for production, say so explicitly — agents will then walk through [`infra/WINDOWS.md`](../infra/WINDOWS.md) with cost expectations.

---

## Stop / reset

```powershell
npm run infra:down          # stop Docker services
docker compose down -v      # + delete volumes (wipes local DB)
```
