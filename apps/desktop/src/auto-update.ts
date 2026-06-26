/**
 * OPTIONAL-D2 — predictable desktop auto-update.
 *
 * Flow:
 *   1. On every packaged launch (before Postgres/API boot), check GitHub
 *      Releases. If a newer version exists, show the update splash, download
 *      with a progress bar, then `quitAndInstall()` — no manual close step.
 *   2. Help → Check for Updates uses the same download+install path when the
 *      user confirms.
 *   3. After a successful apply + relaunch, show a one-time "What's new"
 *      dialog (pending flag in config.json).
 *
 * We disable `autoInstallOnAppQuit` — installs are always explicit via
 * `quitAndInstall()` so the main process can show progress and avoid the
 * silent "close the app and hope" path that broke on Windows when our
 * `before-quit` handler called `app.exit(0)`.
 */
import { app, dialog, shell } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { autoUpdater } from 'electron-updater';
import type { ProgressInfo } from 'electron-updater';
import {
  closeUpdateSplash,
  isUpdateSplashOpen,
  openUpdateSplash,
  setUpdateSplashChecking,
  setUpdateSplashDownloading,
  setUpdateSplashError,
  setUpdateSplashInstalling,
} from './update-splash.js';
import { mergeDownloadPercent } from './auto-update-progress.js';
import { isNewerVersion } from './version-compare.js';

export { isNewerVersion } from './version-compare.js';
export { mergeDownloadPercent } from './auto-update-progress.js';

interface PersistedConfig {
  pendingWhatsNew?: string;
}

let quittingForUpdate = false;
let updaterConfigured = false;

function configPath(): string {
  return join(app.getPath('userData'), 'config.json');
}

function readConfig(): PersistedConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PersistedConfig;
  } catch {
    return {};
  }
}

function writeConfig(next: PersistedConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf8');
}

/** NSIS passes `--updated` on relaunch; we also set pendingWhatsNew before quit. */
export function isPostUpdateRelaunch(argv: readonly string[] = process.argv): boolean {
  if (argv.includes('--updated')) return true;
  const pending = readConfig().pendingWhatsNew;
  return pending != null && pending === app.getVersion();
}

/** Main process calls this before `quitAndInstall` so shutdown hooks stand aside. */
export function isQuittingForUpdate(): boolean {
  return quittingForUpdate;
}

function configureUpdaterOnce(): void {
  if (updaterConfigured) return;
  updaterConfigured = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.disableWebInstaller = true;
  // Belt-and-suspenders with electron-builder `differentialPackage: false`.
  autoUpdater.disableDifferentialDownload = true;

  autoUpdater.on('error', (err: Error) => {
    console.error('[edi-hub] auto-update error:', err);
  });
}

function markPendingWhatsNew(version: string): void {
  const cfg = readConfig();
  cfg.pendingWhatsNew = version;
  writeConfig(cfg);
}

function installDownloadedUpdate(version: string): void {
  console.log(`[edi-hub] auto-update: installing v${version}`);
  setUpdateSplashInstalling(version);
  markPendingWhatsNew(version);
  quittingForUpdate = true;
  // Silent NSIS apply (/S) into the existing per-user install dir, then relaunch.
  autoUpdater.quitAndInstall(true, true);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download an available update with progress UI, then install immediately.
 * Does not return on success — the process quits for the NSIS installer.
 */
async function downloadAndInstall(version: string, splashAlreadyOpen = false): Promise<void> {
  configureUpdaterOnce();
  if (!splashAlreadyOpen && !isUpdateSplashOpen()) {
    openUpdateSplash();
  }
  setUpdateSplashDownloading(version, 0);

  let peakPercent = 0;
  const onProgress = (progress: ProgressInfo): void => {
    const merged = mergeDownloadPercent(peakPercent, progress.percent);
    peakPercent = merged.peakPercent;
    setUpdateSplashDownloading(version, peakPercent, merged.hint);
  };

  autoUpdater.on('download-progress', onProgress);

  try {
    await autoUpdater.downloadUpdate();
    autoUpdater.removeListener('download-progress', onProgress);

    // `downloadUpdate` resolves when bytes are on disk; install next.
    installDownloadedUpdate(version);
    // quitAndInstall is async from the caller's perspective — give the
    // installer a moment to spawn before we return to boot().
    await sleep(60_000);
  } catch (err) {
    autoUpdater.removeListener('download-progress', onProgress);
    const message = err instanceof Error ? err.message : String(err);
    console.error('[edi-hub] auto-update download failed:', message);
    setUpdateSplashError(message);
    await sleep(8_000);
    closeUpdateSplash();
    throw err;
  }
}

/**
 * Mandatory update gate — runs before Postgres/API boot on packaged installs.
 * Returns `'continue'` when no update is needed or the check failed gracefully.
 */
export async function runStartupUpdateGate(): Promise<'continue'> {
  if (!app.isPackaged) {
    console.log('[edi-hub] auto-update: dev mode, skipping startup gate');
    return 'continue';
  }

  if (isPostUpdateRelaunch()) {
    console.log('[edi-hub] auto-update: post-update relaunch, skipping startup gate');
    return 'continue';
  }

  configureUpdaterOnce();
  openUpdateSplash();
  setUpdateSplashChecking(app.getVersion());

  try {
    const result = await autoUpdater.checkForUpdates();
    const remoteVersion = result?.updateInfo?.version;
    if (!remoteVersion || !isNewerVersion(remoteVersion, app.getVersion())) {
      console.log('[edi-hub] auto-update: already on latest');
      closeUpdateSplash();
      return 'continue';
    }

    console.log(`[edi-hub] auto-update: v${remoteVersion} available — downloading`);
    await downloadAndInstall(remoteVersion, true);
    return 'continue';
  } catch (err) {
    console.error('[edi-hub] auto-update: startup gate failed:', err);
    closeUpdateSplash();
    // Non-fatal — let the user work offline on a flaky network.
    return 'continue';
  }
}

/**
 * Help → Check for Updates. When an update exists, confirm once then
 * download+install immediately (no "close the app first" step).
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

  configureUpdaterOnce();

  try {
    const result = await autoUpdater.checkForUpdates();
    const remoteVersion = result?.updateInfo?.version;
    const current = app.getVersion();

    if (!remoteVersion || remoteVersion === current || !isNewerVersion(remoteVersion, current)) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Check for Updates',
        message: "You're on the latest version of EDI Hub.",
        detail: `Running version ${current}.`,
        buttons: ['OK'],
      });
      return;
    }

    const confirm = await dialog.showMessageBox({
      type: 'info',
      title: 'Update available',
      message: `Install EDI Hub v${remoteVersion} now?`,
      detail:
        `You are on v${current}. The update will download, install, and ` +
        'restart EDI Hub automatically.',
      buttons: ['Install now', 'Not now'],
      defaultId: 0,
      cancelId: 1,
    });
    if (confirm.response !== 0) return;

    await downloadAndInstall(remoteVersion);
  } catch (err) {
    console.error('[edi-hub] manual check failed:', err);
    await dialog.showMessageBox({
      type: 'error',
      title: 'Check for Updates',
      message: 'Could not install the update.',
      detail: err instanceof Error ? err.message : String(err),
      buttons: ['OK'],
    });
  }
}

/**
 * One-time "What's new" after a successful apply. Call after the main window
 * loads.
 */
export async function consumePendingWhatsNew(): Promise<void> {
  const cfg = readConfig();
  const pending = cfg.pendingWhatsNew;
  if (!pending) return;
  if (pending !== app.getVersion()) return;

  const next = { ...cfg };
  delete next.pendingWhatsNew;
  writeConfig(next);

  const releaseUrl = `https://github.com/klatar200/EDI-Hub/releases/tag/v${app.getVersion()}`;
  const result = await dialog.showMessageBox({
    type: 'info',
    title: `Welcome to EDI Hub v${app.getVersion()}`,
    message: `You've been updated to v${app.getVersion()}.`,
    detail:
      'Click "Release notes" to see what changed in this version, or dismiss ' +
      'this dialog and get back to work.',
    buttons: ['Release notes', 'OK'],
    defaultId: 1,
    cancelId: 1,
  });
  if (result.response === 0) {
    void shell.openExternal(releaseUrl);
  }
}

/** @deprecated Startup gate replaces the silent background check. */
export function initAutoUpdater(): void {
  // Intentionally empty — kept so older imports don't break during refactors.
}
