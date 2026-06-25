# `.auth/` — Playwright Clerk session state

This directory holds the captured Clerk session that the parity tests
replay. It is **gitignored** because the file contains live session
cookies; check the `.gitignore` here for the exact rules.

## First-time setup (or after the session expires)

```powershell
# 1. Make sure Vite is running on http://localhost:5173
npm run dev -w @edi/web

# 2. In another shell, run the capture script. A real Chromium window
#    opens; sign in with your normal Clerk account, then close the
#    browser. Playwright saves the cookies + localStorage to
#    .auth/state.json.
npm run test:parity:setup
```

The captured state stays valid for ~7 days (Clerk default JWT TTL).
Re-run the setup script when tests start failing with auth errors.

## CI

The CI workflow expects a `CLERK_PARITY_STATE_B64` secret containing
the base64-encoded contents of `.auth/state.json`. When the secret is
absent, the parity job logs a warning and is skipped. To populate it
locally and copy to your clipboard:

```powershell
[Convert]::ToBase64String((Get-Content -AsByteStream .auth\state.json)) | Set-Clipboard
```
