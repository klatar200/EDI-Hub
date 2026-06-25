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

1. Bump `version` in `apps/desktop/package.json` (e.g. `0.0.7-alpha`).
2. Commit and push to `main`.
3. Create and push the matching tag:

```bash
git tag v0.0.7-alpha
git push origin v0.0.7-alpha
```

4. Watch **Actions → release** (~5–10 min on Windows).
5. Confirm assets on https://github.com/klatar200/EDI-Hub/releases:
   - `EDI-Hub-<version>-x64.exe`
   - `EDI-Hub-<version>-x64.exe.blockmap`
   - `latest.yml`

Tag name must match the `v*` pattern in `.github/workflows/release.yml`.

## Required repo secrets

- `VITE_CLERK_PUBLISHABLE_KEY` — required (build fails without it)
- `CSC_LINK_B64` / `CSC_KEY_PASSWORD` — optional (unsigned if missing)
