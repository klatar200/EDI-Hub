# EDI Data Hub — Desktop App Plan (v1 Working Draft)

**Owner:** Keagan
**Status:** Draft — companion to `BUILD_PLAN.md`
**Decision locked:** Local-first. The desktop app bundles API, database, and storage. EDI never leaves the customer's machine/network.
**Anti-drift check:** A desktop build serves *stability* (no cloud dependency, no data-sovereignty objection) and unlocks the on-prem segment Gate 1 flagged. It does not add features outside v1 scope.

---

## 1. The Objective

Ship a downloadable installer (`.exe` for Windows, `.dmg` for macOS, optional `.AppImage`/`.deb` for Linux) that gives a single company the full Phase 3–7 hub experience on one machine or one internal server, with zero outbound network dependency for core function. UI must be visually and behaviorally identical to the web build — same React bundle, different runtime shell.

**North Star unchanged:** transaction lifecycle stitching. The desktop app is a *delivery vehicle*, not a different product.

---

## 2. The One-Line Architecture

> Electron shell launches a packaged Fastify API as a child process; the API runs against an embedded SQLite database and the local filesystem; the same React+Vite bundle is served from a `file://` URL inside a BrowserWindow.

That sentence is the whole shape. Everything below is detail.

---

## 3. UI Parity Strategy (the part you asked about specifically)

**Same codebase. Same bundle. No fork.**

The current `apps/web` already produces a static `dist/` output (Vite). Desktop loads that exact build. UI parity is a build-pipeline outcome, not an ongoing maintenance burden — if it ships to the web, it ships to desktop on the next build.

Mechanism:

1. **Single source of UI truth.** `apps/web` remains the canonical React app. No copies, no shadcn divergence, no Tailwind config drift.
2. **Runtime API base URL.** Today the web app hits a known API host. Replace the hardcoded base URL with `window.__EDI_API_BASE__`, injected by Electron's preload script before the React app boots. Web build sets it to `/api`; desktop sets it to `http://127.0.0.1:<dynamic-port>`.
3. **Feature flags for runtime differences.** A small `runtime` object on `window` exposes `{ mode: 'web' | 'desktop', version, platform }`. Components that legitimately differ (e.g. "Open in Finder" only makes sense on desktop) read from this flag rather than maintaining two component trees.
4. **Visual regression gate.** Add Playwright screenshot tests that run against both web and desktop builds in CI. Any pixel-level drift fails the build. This is the mechanism that *enforces* parity over time.
5. **Same shadcn theme tokens, same Tailwind config.** No platform-specific styling. The window chrome (title bar, traffic lights) is the only desktop-only visual.

**Cost of parity:** roughly two days of one-time refactor (env-injected API base, runtime flag plumbing) plus the Playwright harness. After that, parity is automatic.

---

## 4. Stack Decisions

| Concern | Web stack today | Desktop equivalent | Rationale |
|---|---|---|---|
| Shell | n/a | **Electron** | Solo TypeScript dev, mature ecosystem, predictable Chromium rendering = pixel-perfect parity. Tauri is smaller but adds a Rust surface area you don't need a second front on. |
| Frontend | React + Vite + Tailwind + shadcn | **Same bundle, unmodified** | Parity guarantee. |
| API | Fastify (Node 20, TS) | **Same Fastify app, run as forked Node child** | Reuse 100% of `apps/api`. Compiled to JS and packaged via `electron-builder`'s `extraResources`. |
| Database | PostgreSQL via Prisma | **SQLite via Prisma** | Embedded, zero-install, single-file backup. Prisma supports both — most schema works unchanged. This is the single biggest change to the existing codebase. See §6. |
| Background jobs | BullMQ + Redis | **SQLite-backed job table + in-process worker** | Bundling Redis on Windows is painful and unnecessary at one-machine scale. A small `jobs` table + setInterval poller covers every Phase 7 alerting use case. |
| Raw file storage | AWS S3 | **Local filesystem** under `app.getPath('userData')/raw/` | Same key convention, same DB record shape, different backend. |
| Auth | Clerk | **Local accounts** (bcrypt + SQLite) or single-user mode | Multi-tenant isolation doesn't apply on a single-machine install. Local users are for RBAC inside one company. |
| Auto-update | n/a | **electron-updater** against signed releases on S3/GitHub | Standard pattern. |
| Installer | n/a | **electron-builder** → NSIS (Win), DMG (mac), AppImage (Linux) | |

---

## 5. Repo Changes

Add one new app, no churn elsewhere:

```
/apps
  /api          # unchanged — but builds to dist/ for packaging
  /web          # unchanged — runtime API base via window injection
  /desktop      # NEW — Electron main + preload, electron-builder config
/packages
  /db           # Prisma schema gains a sqlite provider variant
  ...
```

`apps/desktop` is small (~500 LoC): main process boot, API child-process supervisor, IPC bridge, auto-update hooks, native menus, and `electron-builder.yml`.

---

## 6. The SQLite Migration (the real work)

Prisma supports SQLite as a first-class provider, but the schema needs a sweep. Items that will change:

- `@db.Uuid` columns → `String` with `@default(uuid())` at the app layer (SQLite has no native UUID type).
- `Json` / `Jsonb` columns → `String` with JSON serialization in code (SQLite stores JSON as TEXT; queries that filtered by JSON path need rework).
- `@db.Timestamptz` → SQLite stores as TEXT/INTEGER; standardize on ISO-8601 strings or epoch ms and pick *one*.
- Postgres-specific functions in raw SQL (`gen_random_uuid()`, `now()`, full-text search) need replacement.
- Migrations: separate migration history per provider. Use a `prisma/schema.postgres.prisma` + `prisma/schema.sqlite.prisma` split, generated from a shared source, or — simpler — maintain the schema with provider-portable types only and switch the provider via env.

**Recommended:** maintain one provider-portable Prisma schema (no `@db.*` Postgres-specific attributes), switch provider via `DATABASE_PROVIDER` env, and accept the loss of native JSONB querying. The hub does not need rich JSON queries in v1.

Effort: 1–2 weeks including a full pass through the parsing/storage tests against SQLite.

---

## 7. Replacing BullMQ on Desktop

Two paths:

- **Conditional adapter:** keep BullMQ for the web build, add a `LocalJobQueue` implementation (SQLite-backed, single-process) selected at boot. The existing job *interface* doesn't change.
- **Switch entirely to a portable queue** like `graphile-worker` (Postgres-only) or a hand-rolled SQLite jobs table.

Recommended: the conditional adapter. It keeps the web/SaaS roadmap untouched and contains the desktop change to a single module.

Phase 7 alerting works fine on a polling worker at one-machine scale — alert latency of "checked every 30 seconds" is acceptable for SLA-window misses measured in hours.

---

## 8. Local Storage of Raw Files

Replace S3 calls with a thin adapter. The DB still stores a "key" — for web that key is an S3 object key; for desktop it's a relative path under `<userData>/raw/`. Same indirection, same dedupe-by-hash logic, same "raw file is sacred" guarantee.

Backups: ship a one-click "Export backup" that produces a single `.zip` containing the SQLite file + the raw/ directory. Restore is the reverse. This *replaces* the Phase 10 RDS backup story for the desktop SKU.

---

## 9. Auth & Multi-Tenancy

The Phase 9 multi-tenancy work in `BUILD_PLAN.md` does not apply to desktop. One install = one company. Skip Clerk; use local accounts with bcrypt + the existing RBAC (`viewer`/`ops`/`admin`) from `CLAUDE.md` §Phase 9. The `tenantId` column stays in the schema but is always a single fixed value on desktop builds — that keeps the API code identical across SKUs.

This is a *feature* of the desktop path: it ships earlier than the SaaS path because it skips the hardest, least-compressible phase.

---

## 10. Distribution, Signing, Licensing

| Item | What's needed | Cost / friction |
|---|---|---|
| Windows code signing | EV code-signing certificate (DigiCert, Sectigo, SSL.com) — required to avoid SmartScreen warnings on day one | ~$300–600/year, hardware token |
| macOS code signing + notarization | Apple Developer Program enrollment + notarization via `notarytool` | $99/year |
| Auto-update | `electron-updater` reading a release feed on S3 or GitHub Releases | Free if GitHub Releases |
| Linux | AppImage or `.deb`; no signing requirement | Free |
| License keys | Local-validated keys (Ed25519 signature) with optional online activation check on first run | Build it; ~3 days |
| Telemetry (opt-in) | Anonymous usage + crash reporting via Sentry desktop SDK | Free tier covers early users |

License key flow: ship a free 14-day trial that runs unrestricted; activation enters a signed key the app verifies offline; optional periodic online "still valid" check that *fails open* (network outage never kills a paying customer).

---

## 11. Where This Fits in the Existing Roadmap

The desktop track is a **parallel branch from M3 (Internal MVP, end of Phase 7)**. It is not a replacement for the SaaS phases — it is a second SKU you can sell into the on-prem segment.

Suggested sequencing:

1. **Hold until M3.** Do not start desktop packaging before Phase 7 ships. The product needs to exist before you wrap it.
2. **At M3, fork into two tracks.**
   - **Track A (SaaS):** continue with Phases 8 → 9 → 10 → 11 as written.
   - **Track B (Desktop):** the phases in §12 below.
3. **Track B is the faster route to first paying customer** if your pilot or its peer companies want on-prem. It skips Phase 9 multi-tenancy entirely.
4. **Both tracks share future feature work.** Anything you build for SaaS Phase 8 (outbound visibility, second ingestion channel) flows into desktop on the next release cut, because the API and UI code are identical.

---

## 12. Desktop Track — Phase Plan

Effort assumes 15–25 hrs/week solo with Opus accelerating code. Phases are dependent — do not parallelize.

### D1 — SQLite migration of `packages/db` and `apps/api`
**Goal:** API runs end-to-end against SQLite with all existing tests green.
**Tangible result:** `DATABASE_PROVIDER=sqlite npm run dev:api` boots; ingestion + parsing + lifecycle queries all pass against a local `.db` file.
**Exit:** test suite green on both Postgres and SQLite in CI.
**Effort:** 1–2 weeks.

### D2 — Local job queue adapter
**Goal:** Replace the BullMQ dependency at the desktop boundary.
**Tangible result:** Phase 7 missing-ack detection runs against the SQLite jobs table on a polling worker; web build still uses BullMQ.
**Exit:** Alert fires correctly in a desktop dev build for a missing 997.
**Effort:** ~1 week.

### D3 — Local file storage adapter
**Goal:** Replace S3 calls with a filesystem adapter selected by config.
**Tangible result:** Raw 850 lands under `<userData>/raw/`, hash-dedupes, round-trips through the UI.
**Exit:** All ingestion paths work without AWS credentials.
**Effort:** ~3 days.

### D4 — Electron shell + API supervisor
**Goal:** Standalone Electron app boots the API child process, waits for it to be ready, opens a BrowserWindow on the React build.
**Tangible result:** Double-click the dev build → app opens → log in → see transactions.
**Key tasks:** main process boot, port selection, child-process lifecycle (restart on crash), preload script that injects `window.__EDI_API_BASE__` and `window.runtime`, native menus, devtools toggle.
**Exit:** Cold-start to logged-in dashboard in under 4 seconds on a mid-range laptop.
**Effort:** 1–2 weeks.

### D5 — UI parity harness
**Goal:** Lock UI parity in CI so it never silently drifts.
**Tangible result:** Playwright runs the same scripted user flow against the web build and the packaged desktop build; produces side-by-side screenshots and a diff report. CI fails on diff above threshold.
**Exit:** Three critical flows (transaction list, lifecycle view, alert acknowledgment) covered with green diffs.
**Effort:** ~1 week.

### D6 — Installer + code signing
**Goal:** Produce a signed installer per OS.
**Tangible result:** `npm run dist` outputs signed `.exe`, `.dmg`, `.AppImage` from a CI build. Windows install completes with no SmartScreen warning. macOS install completes with no Gatekeeper warning.
**Key tasks:** electron-builder config, EV cert procurement (Windows), Apple Developer enrollment + notarization, GitHub Actions workflow for signed release builds.
**Exit:** A non-developer can download, install, and launch on a clean machine. **Calendar friction:** cert procurement and notarization take real wall-clock time; start D6 early in the track.
**Effort:** 2–3 weeks (most of that is paperwork and cert delivery, not coding).

### D7 — Auto-update
**Goal:** Existing installs upgrade themselves.
**Tangible result:** Bump version, publish a signed release, installed apps detect, download, and apply the update on next launch.
**Exit:** Two consecutive versions tested in the wild.
**Effort:** ~1 week.

### D8 — Licensing + first-run experience
**Goal:** Make it sellable as a product, not a side download.
**Tangible result:** 14-day trial counter, license key entry screen, signed-key validation, optional online activation. First-run wizard walks a new customer through SFTP folder selection and partner config (Phase 6 surface) without docs.
**Exit:** A test customer can install, complete onboarding, and ingest a real file with zero hand-holding.
**Effort:** 2–3 weeks.

### D9 — Backup/restore + crash reporting
**Goal:** Make it survivable in a customer's hands.
**Tangible result:** One-click backup export, restore-from-backup wizard, opt-in Sentry crash reporting.
**Exit:** A restore drill produces a working app from a backup zip on a different machine.
**Effort:** ~1 week.

**Total Track B effort from M3:** roughly **10–14 weeks** of calendar time at the stated pace — meaningfully faster than Track A's path to "Sellable" because Phase 9 multi-tenancy is sidestepped entirely.

---

## 13. Risks Specific to the Desktop Track

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SQLite migration uncovers Postgres-specific assumptions throughout the codebase | High | Medium | D1 is the first phase for a reason. Provider-portable schema discipline going forward. |
| Code-signing cert procurement delays D6 | Medium | Medium | Order the cert the day Track B starts, not at D6. |
| Windows Defender false-positives on a new signed binary | Medium | Medium | Submit to MS for analysis pre-launch; EV cert reduces but doesn't eliminate. |
| UI silently drifts between web and desktop bundles | Medium | High | D5 harness — non-negotiable. |
| Customer support burden of installed software (logs, versions, OS variance) | High | Medium | In-app "Export diagnostic bundle" button from day one. |
| Licensing online-check kills offline customers | Low | High | Fail-open design. Never let activation network calls block app function. |

---

## 14. Open Questions (Need Your Answers to Finalize Track B)

1. **One desktop SKU, or two?** Just "desktop client for a workstation" — or also a "small-server install" intended to run on an on-prem VM and be accessed by multiple users on the LAN? The second is meaningfully more work (real auth, real RBAC, multi-user concurrency on SQLite gets shaky — may need to keep Postgres for that variant).
2. **Pricing model for the desktop SKU.** One-time perpetual license, annual subscription, or per-seat? Affects D8 design.
3. **Auto-update opt-in or forced?** Some on-prem buyers explicitly want to control update timing.
4. **Telemetry stance.** Opt-in only, or off entirely for the on-prem SKU? Some buyers will refuse any outbound telemetry.
5. **Linux — yes or no for v1?** Adds CI surface area; cuts a sliver of the market if dropped. Default recommendation: skip for v1, add after first paying desktop customer asks.

---

## 15. Recommended First Step

If you want to start de-risking this *now* without forking effort away from the SaaS roadmap, the single highest-leverage move is **D1 (the SQLite migration)**. It's the largest unknown, it benefits the SaaS build too (cheaper local dev environment, no Docker required to run tests), and finishing it tells you whether the full desktop track is a 10-week effort or a 20-week one.

Everything else in this plan is mechanical once D1 lands.
