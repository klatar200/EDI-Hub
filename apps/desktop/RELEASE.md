# Desktop release checklist

Merging to `main` does **not** create a GitHub Release. Releases are
triggered only by pushing a version tag.

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
