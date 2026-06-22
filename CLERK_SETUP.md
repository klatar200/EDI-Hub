# Clerk setup — Phase 9 Sprint 2

This is the one-time external setup you do in the Clerk dashboard. Run it once
when standing up a fresh environment (dev, staging, prod). The values you
collect here go into `.env`.

You can do this in parallel with the code changes — the API has a dev fallback
that pins requests to the pilot tenant when Clerk env vars are missing, so the
existing dev workflow keeps working until you flip the switch.

---

## 1. Create the Clerk application

1. Sign in at [clerk.com](https://clerk.com).
2. Create a new application: **EDI Data Hub (dev)**.
3. Choose authentication strategies — recommended: **Email link** + **Google**
   for dev. SSO/SAML are paid features (Enterprise) you can layer in later.

## 2. Enable Organizations

Clerk's Organizations are what we map to our `Tenant` rows.

1. In the Clerk dashboard, navigate to **Organizations → Settings**.
2. Toggle **Enable Organizations** on.
3. Under **Default role for new members**, leave at `basic_member` (we mirror
   this to our `viewer` role; admins are promoted via the Users page later).
4. Confirm your billing plan supports Organizations — the **Hobby** plan
   ($25/mo) is the minimum tier that includes Organizations. Free won't work.

## 3. Copy publishable + secret keys

Dashboard → **API Keys** → choose **React**:

- `Publishable key` (starts with `pk_test_...`) → `.env.local` (preferred)
  or `.env` value **`VITE_CLERK_PUBLISHABLE_KEY`** (used by the web app).
- `Secret key` (starts with `sk_test_...`) → `.env` value **`CLERK_SECRET_KEY`**
  (used by the API to verify JWTs and look up users).

Both go in the repo-root env file. The web build picks up `VITE_`
prefixed values at build time; the API reads the secret key at runtime.

> **Note (current Clerk React API):** the web app imports from
> **`@clerk/react`** (not `@clerk/clerk-react`) and `<ClerkProvider>`
> reads `VITE_CLERK_PUBLISHABLE_KEY` automatically — we do NOT pass the
> key as a prop. If the env var is missing, the provider logs a clear
> error in the browser console at mount time.

## 4. Configure the webhook endpoint

Clerk pushes lifecycle events (org created, member added, etc.) to a URL
you control. We use those events to create the matching `Tenant` and `User`
rows in our DB.

1. Dashboard → **Webhooks** → **Add Endpoint**.
2. Endpoint URL:
   - **Dev**: requires a public tunnel (Clerk can't reach `localhost`).
     Easiest: run `npx ngrok http 3000`, then point the endpoint at
     `https://<your-tunnel>.ngrok-free.app/webhooks/clerk`. Restart ngrok
     and update the URL whenever you reboot.
   - **Staging / prod**: use the ALB hostname: `https://api.<your-domain>/webhooks/clerk`.
3. Subscribe to events:
   - `organization.created`
   - `organization.updated` (optional — renames flow through)
   - `organizationMembership.created`
   - `organizationMembership.deleted`
   - `user.deleted` (optional — for soft-delete cleanup)
4. After saving, copy the **Signing Secret** (starts with `whsec_...`) →
   `.env` value **`CLERK_WEBHOOK_SECRET`**.

## 5. Add the env vars

Append to `.env.local` (preferred — automatically gitignored) or `.env`.
Never commit secret values.

```env
# --- Clerk auth ---
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...
```

## 6. Create the pilot Clerk Organization

So existing data attaches to a real Clerk org instead of the bootstrap
pilot tenant:

1. Sign up in the running app (or via the Clerk dashboard's **Users** page).
2. Create an Organization called **Pilot** (or your employer's name).
3. The `organization.created` webhook fires → creates a `Tenant` row
   automatically. But you DON'T want a brand-new tenant — you want the
   webhook to attach to the EXISTING pilot tenant that already owns all the
   data.

   To attach: run the one-shot reattach script after creating the org:
   ```bash
   npm run attach-pilot-org --workspace=@edi/api -- <clerk_org_id>
   ```
   (You'll find the `org_*` id in the Clerk dashboard → Organizations.)

   This sets `clerkOrgId` on the existing pilot tenant row, so the
   `organization.created` event becomes a no-op (idempotent on
   `clerkOrgId` uniqueness).

## 7. Verify

```bash
npm run dev
```

Open the web app. You should see a Clerk sign-in screen. Sign in as the
admin user you created. The existing pilot data should appear — that's the
attached tenant in action.

---

## Troubleshooting

- **Webhook fires but no Tenant row is created** — check the API logs for
  `clerk webhook: signature verification failed`. The most common cause is
  pasting the wrong signing secret, or env var not loaded.
- **Sign-in works but every request is 401** — the JWT isn't being attached
  to fetch calls. Check `apps/web/src/lib/api.ts` is using
  `getToken({ template: 'edi-hub' })` (or whatever JWT template you defined).
- **Cross-tenant 404 when you expect 200** — the tenant the user belongs to
  doesn't have a matching `clerkOrgId` in the DB. Re-check the webhook
  delivery log in Clerk.
- **Free plan complaints** — Organizations require Hobby. Upgrade in
  dashboard → Billing.
