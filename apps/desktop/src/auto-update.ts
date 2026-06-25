/**
 * Desktop track D7 Sprint 1 — silent auto-update via electron-updater.
 *
 * Wiring overview:
 *
 *   - At startup, after the main window is up, we kick off
 *     `autoUpdater.checkForUpdates()`. With `autoDownload: true` an
 *     available update streams down in the background; the user sees
 *     nothing.
 *   - When `update-downloaded` fires we persist the pending version to
 *     `<userData>/config.json`. `autoInstallOnAppQuit: true` then
 *     installs it on the next normal app quit / relaunch.
 *   - On the next launch into the new version, `consumePendingWhatsNew()`
 *     reads the persisted version, compares to `app.getVersion()`, and
 *     shows a one-time "What's new in X.Y.Z" dialog, then clears the
 *     flag so it never reappears.
 *
 * The "Check for Updates" menu item calls `manualCheckForUpdates()`
 * which is the same flow with progress dialogs surfaced — every state
 * (no update / downloading / downloaded / error) shows a dialog so the
 * user gets feedback that the click did something.
 */
import { app, dialog, shell } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { autoUpdater } from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';

/** True when `candidate` is strictly newer than `current` (0.0.x semver). */
function isNewerVersion(candidate: string, current: string): boolean {
  const core = (v: string) => v.split('-')[0]!.split('.').map((n) => Number.parseInt(n, 10));
  const c = core(candidate);
  const r = core(current);
  for (let i = 0; i < 3; i++) {
    const a = c[i] ?? 0;
    const b = r[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

// Note on the import shape: electron-updater is a CJS module that
// sets `__esModule: true` on its module.exports. That trips up the
// default-import-with-__importDefault pattern we use for @prisma/client
// — `.default` is undefined on this package because there is no
// default export, only named ones. A plain named import compiles to
// `require('electron-updater').autoUpdater`, which is exactly what we
// want.

interface PersistedConfig {
  /** Set on `update-downloaded`. Read + cleared on next launch when
   *  the running app's version matches — that's how we know "the
   *  update we downloaded has actually been applied now." */
  pendingWhatsNew?: string;
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json');
}

function readConfig(): PersistedConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PersistedConfig;
  } catch {
    // Corrupted config is non-fatal — drop it and start fresh.
    return {};
  }
}

function writeConfig(next: PersistedConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf8');
}

/**
 * One-time setup. Call from `app.whenReady()` after the main window
 * exists.
 *
 * In dev mode (`!app.isPackaged`) electron-updater can't actually pull
 * an update — there's no installer to swap out — so we short-circuit
 * the whole flow. `Check for Updates` from the menu will still show a
 * "dev mode" dialog so the developer knows the wiring exists.
 */
export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    console.log('[edi-hub] auto-update: dev mode, skipping checkForUpdates');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // NSIS full installer only — no web installer stub.
  autoUpdater.disableWebInstaller = true;

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    if (!isNewerVersion(info.version, app.getVersion())) {
      console.warn(
        `[edi-hub] auto-update: ignoring downloaded v${info.version} — not newer than v${app.getVersion()}`,
      );
      return;
    }
    console.log(`[edi-hub] auto-update: downloaded v${info.version}, will install on next quit`);
    const cfg = readConfig();
    cfg.pendingWhatsNew = info.version;
    writeConfig(cfg);
  });

  // Silent failure paths — we don't want to surface a dialog when the
  // user didn't ask. Logs are enough.
  autoUpdater.on('error', (err: Error) => {
    console.error('[edi-hub] auto-update error:', err);
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[edi-hub] auto-update: no update available');
  });

  // Fire and forget. checkForUpdates returns a promise; attach a catch so
  // a 404 on the release asset doesn't surface as an unhandled rejection.
  void autoUpdater.checkForUpdates().catch((err: unknown) => {
    console.error('[edi-hub] auto-update: initial check failed:', err);
  });
}

/**
 * Triggered by the Help → Check for Updates menu. Unlike the silent
 * background check, this one surfaces every state through a dialog
 * so the user knows the click landed.
 */
export async function manualCheckForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Check for Updates',
      message: 'Updates are disabled in development.',
      detail: 'Run the packaged installer to test the auto-update flow.',
      buttons: ['OK'],
    });
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.updateInfo) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Check for Updates',
        message: "You're on the latest version of EDI Hub.",
        detail: `Running version ${app.getVersion()}.`,
        buttons: ['OK'],
      });
      return;
    }
    const newVersion = result.updateInfo.version;
    if (newVersion === app.getVersion()) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Check for Updates',
        message: "You're on the latest version of EDI Hub.",
        detail: `Running version ${app.getVersion()}.`,
        buttons: ['OK'],
      });
      return;
    }
    // Guard against a corrupted release feed offering a downgrade (happened
    // when v0.0.10-alpha was tagged before package.json was bumped).
    if (!isNewerVersion(newVersion, app.getVersion())) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Check for Updates',
        message: 'No newer version is available.',
        detail:
          `You are running v${app.getVersion()}. The update server reported ` +
          `v${newVersion}, which is not newer — the release feed may be out of ` +
          'sync. Download the latest installer manually from GitHub Releases.',
        buttons: ['OK'],
      });
      return;
    }
    // An update is in flight — autoDownload kicked off the download.
    await dialog.showMessageBox({
      type: 'info',
      title: 'Update available',
      message: `Update to v${newVersion} is downloading.`,
      detail:
        'The update will be applied automatically the next time you quit and ' +
        'relaunch EDI Hub. You can keep using the current version in the meantime.',
      buttons: ['OK'],
    });
  } catch (err) {
    console.error('[edi-hub] manual check failed:', err);
    await dialog.showMessageBox({
      type: 'error',
      title: 'Check for Updates',
      message: 'Could not check for updates.',
      detail: err instanceof Error ? err.message : String(err),
      buttons: ['OK'],
    });
  }
}

/**
 * If a previous launch downloaded an update and we have just been
 * relaunched into that new version, show a one-time "What's new"
 * dialog. Clears the flag in `config.json` after showing.
 *
 * Call from `app.whenReady()` after the main window's
 * `did-finish-load`. The dialog is informational; we don't block on
 * the user dismissing it.
 */
export async function consumePendingWhatsNew(): Promise<void> {
  const cfg = readConfig();
  const pending = cfg.pendingWhatsNew;
  if (!pending) return;
  // The flag is keyed by version. Only show "What's new" when the
  // running version matches the version we previously downloaded —
  // otherwise the user might see "What's new in 0.2.0" on an unrelated
  // launch.
  if (pending !== app.getVersion()) return;

  // Clear the flag BEFORE showing so a crash inside the dialog can't
  // pin us in a loop.
  const next = { ...cfg };
  delete next.pendingWhatsNew;
  writeConfig(next);

  const releaseUrl = `https://github.com/klatar200/EDI-Hub/releases/tag/v${app.getVersion()}`;
  const result = await dialog.showMessageBox({
    type: 'info',
    title: `Welcome to EDI Hub v${app.getVersion()}`,
    message: `You've been updated to v${app.getVersion()}.`,
    detail:
      'Click "Release notes" to see what changed in this version, or just ' +
      'dismiss this dialog and get back to work.',
    buttons: ['Release notes', 'OK'],
    defaultId: 1,
    cancelId: 1,
  });
  if (result.response === 0) {
    void shell.openExternal(releaseUrl);
  }
}
