# Desktop auto-update scorecard

Grades each fix round against what a user on Windows actually experienced.
**Pass** = user could update without confusion, errors, or broken shortcuts.
**Partial** = update eventually succeeded but UX was poor or misleading.
**Fail** = broken launch, wrong version, or no path to success without manual reinstall.

| Round | Version | Change shipped | Grade | What happened (user evidence) |
|-------|---------|----------------|-------|-------------------------------|
| 1 | 0.0.15–0.0.17 | Startup gate, monotonic progress, `quitAndInstall(true,true)` | **Partial** | Progress bar reset fixed; NSIS wizard still appeared on update |
| 2 | 0.0.18 | `oneClick: true` in electron-builder | **Partial** | Wizard reduced to loading bar; still interactive feel |
| 3 | 0.0.19 | `differentialPackage: false`, skip gate on `--updated`, NSIS hide macros | **Partial** | Double-download/progress issues improved; post-update boot still ~80s; silent gap remained |
| 4 | 0.0.20 | Dedicated `update-YYYY-MM-DD.log` | **Pass** (diagnostics only) | Log worked — essential for debugging subsequent rounds |
| 5 | 0.0.21 | `electron-updater` forced into package + CI pack verify | **Fail→Partial** | `Cannot find module 'electron-updater'` after update until manual reinstall |
| 6 | 0.0.22 | Version bump (test target) | **N/A** | Stepping-stone release; still ran 0.0.21 updater code paths |
| 7 | 0.0.23 | `quitAndInstall(false,true)`, install handoff, splash copy | **Fail** (for 0.0.22→0.0.23) | User still saw `/S` silent install because **updater runs from the installed app (0.0.22), not the target (0.0.23)**. ~5m22s dead zone, JS error on dead shortcut, eventual success on 0.0.23 |
| 8 | 0.0.24 | CI `verify-update-behavior.mjs` + unit tests; test release from 0.0.23 | **Pass** | 0.0.23→0.0.24 log: `isSilent:false`, args `--updated,--force-run` (no `/S`), `install_handoff` + `install_complete` (`gapMs`: 303758), clean boot to 0.0.24-alpha, `whats_new` shown. No JS error reported. |

## Root cause the scorecard exposes

Auto-update code is **always the version already installed**. A fix in v0.0.23 does not apply when updating **from** v0.0.22. The 0.0.22→0.0.23 log proves this:

```
install_quit | {"isSilent":true,...}
Executing: ...EDI-Hub-0.0.23-alpha-x64.exe with args: --updated,/S,--force-run
```

0.0.23 source logs `isSilent:false` and calls `quitAndInstall(false, true)`. Those lines never ran — 0.0.22 did.

## Validation gates added in round 8

Before any future desktop release ships:

1. `node scripts/verify-update-behavior.mjs` after `tsc --build` (and after `npm run dist` on Windows CI)
2. `apps/desktop/test/update-behavior.test.ts` — compiled output must not contain silent `quitAndInstall(true, …)`
3. `scripts/verify-desktop-pack.mjs` — `electron-updater` present in unpacked tree

## How to test 0.0.23 → 0.0.24 (the first real test of the visible-install fix)

1. Confirm Help → About shows **0.0.23-alpha** (not a manual install of 0.0.24).
2. Help → Check for Updates → Install when 0.0.24 is offered.
3. In `update-YYYY-MM-DD.log`, verify **all** of:
   - `install_quit` with `"isSilent":false`
   - `updater_log` **without** `/S` in the Executing line (expect `--updated,--force-run` only)
   - `install_handoff` before quit
   - `install_complete` with `gapMs` on relaunch
4. During apply you should see an **NSIS installer progress window** (not a blank multi-minute wait).
5. Do **not** click the Start Menu shortcut until the installer window closes — it points at a missing exe mid-apply (this is the likely JS error source).

## Round 8 user validation (0.0.23 → 0.0.24, 2026-06-26)

| Criterion | Log evidence | Result |
|-----------|--------------|--------|
| Non-silent install | `install_quit` → `"isSilent":false`; updater `Install: isSilent: false` | ✅ |
| No `/S` flag | `Executing: ... args: --updated,--force-run` | ✅ |
| Install handoff | `install_handoff` at 20:15:23.590Z | ✅ |
| Install complete timing | `install_complete` → `gapMs: 303758` (~5m 4s) | ✅ |
| Successful relaunch | `session_start` → `appVersion":"0.0.24-alpha"` with `--updated` | ✅ |
| Post-update UX | `whats_new` for 0.0.24-alpha | ✅ |
| No module crash | No `electron-updater` or JS error in log | ✅ |

**Timeline:** download ~3s → 2.5s install splash → NSIS apply ~5m 4s → boot ~80s → window ready.

Compare to round 7 (0.0.22→0.0.23): same ~5m apply duration, but round 7 used silent `/S` with no handoff logging and a reported JS error on the dead shortcut.
