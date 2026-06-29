# Clerk setup

**When:** Local dev (optional) or staging/production at go-live.

**Related:** [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md) · [`BUILD_PLAN.md`](BUILD_PLAN.md) (deploy track)

---

## Local development ($0)

| Approach | Cost | When |
|----------|------|------|
| **Dev-fallback** | Free | Leave `CLERK_SECRET_KEY` blank — API pins pilot tenant |
| **Clerk Free + test keys** | Free | Real sign-in with `pk_test_` / `sk_test_` in `.env` |

Copy `.env.example` → `.env`.

---

## Staging / production

One-time per environment. Values in `.env` (local) or Secrets Manager (AWS) — never commit secrets.

### 1. Create application

[clerk.com](https://clerk.com) → **EDI Data Hub (dev|staging|prod)**. Auth: Email link + Google recommended.

### 2. Enable Organizations

Maps to `Tenant` rows. Requires **Clerk Hobby** ($25/mo) — defer until go-live for local dev-fallback.

### 3. API keys

| Variable | Source |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_test_...` or `pk_live_...` |
| `CLERK_SECRET_KEY` | `sk_test_...` or `sk_live_...` |

### 4. Webhook

- **Dev:** ngrok → `https://<tunnel>/webhooks/clerk`
- **Staging/prod:** `https://api.<domain>/webhooks/clerk`

Events: `organization.created`, `organization.updated`, `organizationMembership.created`, `organizationMembership.deleted`, optional `user.deleted`.

`CLERK_WEBHOOK_SECRET=whsec_...`

### 5. Attach pilot org (local)

```powershell
npm run attach-pilot-org --workspace=@edi/api -- org_xxxxxxxx
npm run seed-pilot-admin --workspace=@edi/api -- user_xxx you@example.com admin
```

Or: `npm run reconcile-clerk --workspace=@edi/api`

### 6. Troubleshooting

| Symptom | Fix |
|---------|-----|
| No Tenant after webhook | Check `CLERK_WEBHOOK_SECRET`, env loaded |
| 401 on API | JWT not attached — `apps/web/src/lib/api.ts` |
| 404 cross-tenant | `clerkOrgId` mismatch; webhook log |
| Organizations error | Clerk Hobby required for multi-org |

**Desktop production:** use `pk_live_` / `sk_live_` before selling.
