# Desktop release checklist

Merging to `main` does **not** create a GitHub Release. Releases are
triggered only by pushing a version tag.

## Where app data lives (Windows)

All local state — `license.json`, Postgres (`pgdata/`), ingested files
(`raw/`), auto-update config — is under Electron **userData**:

```
%APPDATA%\EDI Hub\
```

Full path example: `C:\Users\<you>\AppData\Roaming\EDI Hub\`

**In the app:** Help → **Open Data Folder** (v0.0.8-alpha+).

**Backup / restore (v0.0.9-alpha+):** Help → **Export Backup** / **Restore from Backup**.
Archives contain `pgdata/` + `raw/` + `manifest.json`.

**In logs:** every launch prints `[edi-hub] userData: ...` when run with
`--enable-logging`.

### Legacy installs (before v0.0.8-alpha)

Older builds used the npm package name (`@edi/desktop`) for userData, so
data may be under a different folder. Search with PowerShell:

```powershell
Get-ChildItem $env:APPDATA, $env:LOCALAPPDATA -Recurse -Filter license.json -ErrorAction SilentlyContinue |
  Select-Object FullName
```

Also search for a `pgdata` folder — that is always created on first launch.

---

## Every desktop release

1. Bump `version` in `apps/desktop/package.json` (e.g. `0.0.13-alpha`).
2. Commit and push to `main`.
3. On `main`, create and push the matching tag (use the helper — it checks
   you're on latest `main` and that the tag matches `package.json`):

```bash
git checkout main
git pull origin main
npm run release:tag -- --push
```

Or manually:

```bash
git tag v0.0.13-alpha
git push origin v0.0.13-alpha
```

4. Watch **Actions → release** (~5–10 min on Windows).
5. Confirm assets on https://github.com/klatar200/EDI-Hub/releases:
   - `EDI-Hub-<version>-x64.exe` — **filename version must match the release tag**
   - `EDI-Hub-<version>-x64.exe.blockmap`
   - `latest.yml`

Tag name must match the `v*` pattern in `.github/workflows/release.yml`.
The workflow **fails** if:

- the tag (without `v`) does not exactly match `apps/desktop/package.json`
  `version` at the tagged commit, or
- the tagged commit is **not** the current tip of `origin/main`.

**Never re-push an existing tag name onto a different commit.** Delete the
old tag on GitHub and locally first, then create a new version number.

### Troubleshooting auto-update

**Expected behavior (v0.0.15-alpha+):**

1. On launch, EDI Hub checks GitHub Releases **before** starting Postgres.
2. If a newer version exists, an update screen shows download progress, then
   installs **silently** and restarts automatically — no NSIS wizard, no manual quit.
3. Help → Check for Updates → **Install now** uses the same path.

**v0.0.17-alpha+** disables differential downloads (avoids the progress bar
resetting to 0% mid-update) and uses silent NSIS apply (`/S`).

**v0.0.18-alpha+** switches to a one-click NSIS installer. The assisted
installer showed a per-user vs all-users wizard on every update because that
custom page ignores `/S`; one-click applies updates with no wizard.

**v0.0.20-alpha+** writes a dedicated auto-update log at
`%APPDATA%\EDI Hub\logs\update-YYYY-MM-DD.log`. Help → **Open Update Log**
opens today's file. Share that file (or paste its contents) when reporting
update issues — it records check/download/install phases, electron-updater
internals, percent drops, and post-update boot timing.

**Symptom:** Help → Check for Updates offers an older version (e.g. v0.0.6
while you run v0.0.8), or restart does not apply an update.

**Symptom:** You downloaded `v0.0.12-alpha` but Help → About shows
`v0.0.6`, and the installer filename is `EDI-Hub-0.0.6-alpha-x64.exe`.

**Cause:** The release tag was pushed on a **stale commit** (not current
`main`), so the workflow built whatever `package.json` said at that old
commit. Tags `v0.0.10-alpha` and `v0.0.12-alpha` both pointed at commit
`40f69e9` where the version was still `0.0.6-alpha`. The GitHub Release
*title* said 0.0.12; the binary was 0.0.6.

**Fix for users:** Do **not** install from `v0.0.10-alpha` or
`v0.0.12-alpha`. Wait for `v0.0.13-alpha` (or newer) and confirm the
`.exe` filename matches the release tag before installing. Auto-update
will work again once a good release is newest on GitHub.

**Fix for releases:**

1. Delete the bad GitHub Release and tag (GitHub → Releases → delete;
   then `git push origin :refs/tags/v0.0.12-alpha`).
2. Bump `package.json` on `main`, commit, push.
3. Tag **current** `main` HEAD only (`npm run release:tag -- --push`).
4. Verify the uploaded asset is `EDI-Hub-<same-version>-x64.exe`.

CI now verifies tag ↔ version, tag ↔ `main` HEAD, and wipes
`dist-installer/` before each build.

### Logs folder

Help → **Open Logs Folder** opens `%APPDATA%\EDI Hub\logs\`. From
v0.0.11-alpha onward the main process writes `edi-hub-YYYY-MM-DD.log`
there on every launch. Older builds did not write log files (console
output was invisible in the packaged app).

Help → **Open Update Log** (v0.0.20-alpha+) opens `update-YYYY-MM-DD.log`
in the same folder — a dedicated trace of the auto-update and post-update
boot path only.

## Required repo secrets

- `VITE_CLERK_PUBLISHABLE_KEY` — required (build fails without it)
- `CSC_LINK_B64` / `CSC_KEY_PASSWORD` — optional (unsigned if missing)
