# EDI Hub — LAN install (D4 Sprint 2 baseline)

This document covers the *one-time configuration* a customer admin
performs after running the EDI Hub installer on a LAN server. The
first-run wizard (D8 Sprint 2) will eventually automate most of these
steps; until then they're manual.

## What the installer leaves running

A single Fastify process on port **3000**, bound to `0.0.0.0`, serving:

- `/api/*` — every authenticated route (partners, transactions, alerts, etc.)
- `/health`, `/readiness`, `/internal/metrics` — public probes
- `/webhooks/clerk` — Clerk identity webhook
- `/` — the React app (the bundled `apps/web/dist`)

Internal users on the LAN reach the hub at `http://<server-ip>:3000`
in any browser.

## Clerk authentication (release builds)

GitHub Actions release builds (`v*` tags) bundle Clerk credentials automatically:

1. **Web UI** — `VITE_CLERK_PUBLISHABLE_KEY` is baked into `apps/web/dist` at build time.
2. **API child** — `scripts/write-clerk-runtime.mjs` writes `clerk-runtime.json` into the installer at `resources/clerk-runtime.json`. The Electron main process forwards these keys to the API on boot.

**Required GitHub repo secrets for production desktop auth:**

| Secret | Purpose |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk sign-in UI (required — build fails without it) |
| `CLERK_SECRET_KEY` | API JWT verification (required for real installs) |
| `CLERK_WEBHOOK_SECRET` | `/webhooks/clerk` endpoint |

If `CLERK_SECRET_KEY` is missing at build time, the installer still runs but the API uses **desktop hub dev-fallback** (no JWT verification). Use only for internal testing.

**LAN authorized parties** (`CLERK_AUTHORIZED_PARTIES`) default to `http://localhost:3000` in the bundled file. Per-install LAN URLs are configured in the first-run wizard (PS-12) or manually — see below.

## One-time Clerk dashboard step (per install)

EDI Hub uses Clerk for authentication, sharing one Clerk application
with the SaaS build. Clerk validates the JWT's `azp` (authorized
party) claim against an allowlist; without that allowlist entry, the
LAN URL will refuse to sign in.

Two places need updating per install:

1. **Clerk dashboard → Allowed redirect URIs** (the customer admin
   does this once, on first install):
   - `http://<server-ip>:3000` — e.g. `http://10.0.0.57:3000`
   - `http://localhost:3000` — only required if anyone signs in *on
     the server machine itself*.
2. **EDI Hub env (`.env.desktop`) → `CLERK_AUTHORIZED_PARTIES`**:
   ```
   CLERK_AUTHORIZED_PARTIES=http://localhost:3000,http://10.0.0.57:3000
   ```
   Comma-separated. The installer reads this and forwards it to the
   Clerk SDK at boot. Restart the EDI Hub service after editing.

If users on the LAN see a Clerk error page complaining about an
"unauthorized party," missing or stale `CLERK_AUTHORIZED_PARTIES` is
the cause 90% of the time.

## Manual env override (development / pre-wizard)

If not using a GitHub-built installer with bundled `clerk-runtime.json`, copy `.env.desktop.example` from the repo root to `.env.desktop` in the install directory, then fill in:

- `CLERK_PUBLISHABLE_KEY` — `pk_live_…` from the Clerk dashboard
- `CLERK_SECRET_KEY` — `sk_live_…` from the Clerk dashboard
- `CLERK_WEBHOOK_SECRET` — `whsec_…` from Clerk webhooks settings
- `CLERK_AUTHORIZED_PARTIES` — see above

Leaving any of the first three blank causes the API to boot in
**pilot-tenant fallback mode**: every request is pinned to the seed
tenant, no JWT verification happens. That's fine for a dev sandbox
but never for a real install — it disables tenant isolation.

## Verifying the install

From the server machine:

```
curl http://localhost:3000/health
# Expect: {"status":"ok",...}
```

From another LAN machine:

```
curl http://<server-ip>:3000/health
```

Then open `http://<server-ip>:3000` in a browser. The Clerk sign-in
card should render. After signing in, the dashboard loads against
live data from the embedded Postgres on the server.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Sign-in redirects, then dashboard shows "Authentication failed" | `azp` claim rejected | Add the LAN URL to **both** Clerk's Allowed redirect URIs **and** `CLERK_AUTHORIZED_PARTIES`. Restart. |
| Browser says `ERR_CONNECTION_REFUSED` from another machine | Port 3000 is not reachable on the LAN | Check Windows Firewall — allow inbound TCP 3000 for the EDI Hub service. |
| Dashboard renders but every API call returns 404 | The React build wasn't bundled | Confirm `WEB_STATIC_DIR` resolves to a directory containing `index.html`. Re-run the installer. |
| Hub logs say `database "edihub" already exists` (warning, not error) | Repeat boot after the first | Harmless — `CREATE DATABASE` is best-effort; the existing cluster is reused. |
