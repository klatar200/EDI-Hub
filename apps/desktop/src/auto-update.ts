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
 * Diagnostic trail: `logs/update-YYYY-MM-DD.log` (Help → Open Update Log).
 */
import { app, dialog, shell } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { autoUpdater } from 'electron-updater';
import type { ProgressInfo, UpdateInfo } from 'electron-updater';
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
import {
  createUpdaterLoggerBridge,
  logDownloadProgress,
  logUpdate,
  resetDownloadProgressLogging,
} from './update-logger.js';
import { consumeInstallHandoff, writeInstallHandoff } from './install-handoff.js';

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

function summarizeUpdateInfo(info: UpdateInfo | undefined): Record<string, unknown> | undefined {
  if (!info) return undefined;
  return {
    version: info.version,
    releaseDate: info.releaseDate,
    files: info.files?.map((f) => ({ url: f.url, size: f.size })),
  };
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

function attachUpdaterEventLoggers(): void {
  autoUpdater.on('checking-for-update', () => {
    logUpdate('updater_log', { level: 'info', message: 'event:checking-for-update' });
  });
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    logUpdate('updater_log', { level: 'info', message: 'event:update-available', detail: summarizeUpdateInfo(info) });
  });
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    logUpdate('updater_log', { level: 'info', message: 'event:update-not-available', detail: summarizeUpdateInfo(info) });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    logUpdate('updater_log', { level: 'info', message: 'event:update-downloaded', detail: summarizeUpdateInfo(info) });
  });
  autoUpdater.on('error', (err: Error) => {
    logUpdate('updater_log', {
      level: 'error',
      message: 'event:error',
      detail: { error: err.message, stack: err.stack },
    });
  });
}

function configureUpdaterOnce(): void {
  if (updaterConfigured) return;
  updaterConfigured = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.logger = createUpdaterLoggerBridge();

  logUpdate('startup_gate', {
    action: 'configure',
    autoDownload: false,
    autoInstallOnAppQuit: false,
    autoRunAppAfterInstall: true,
    disableWebInstaller: true,
    disableDifferentialDownload: true,
  });

  attachUpdaterEventLoggers();

  autoUpdater.on('error', (err: Error) => {
    logUpdate('error', { stage: 'updater', message: err.message, stack: err.stack });
    console.error('[edi-hub] auto-update error:', err);
  });
}

function markPendingWhatsNew(version: string): void {
  const cfg = readConfig();
  cfg.pendingWhatsNew = version;
  writeConfig(cfg);
  logUpdate('install_begin', { pendingWhatsNew: version, configPath: configPath() });
}

async function installDownloadedUpdate(version: string): Promise<void> {
  logUpdate('install_quit', {
    targetVersion: version,
    isSilent: false,
    isForceRunAfter: true,
    quittingForUpdate: true,
  });
  console.log(`[edi-hub] auto-update: installing v${version}`);
  setUpdateSplashInstalling(version);
  markPendingWhatsNew(version);
  writeInstallHandoff(version);
  quittingForUpdate = true;
  // Brief pause so the handoff message is readable before our window closes.
  await sleep(2500);
  // Non-silent NSIS — shows the one-click extract progress bar for the
  // ~minutes spent replacing files. Silent (/S) hid that UI entirely and
  // left users with a dead shortcut and no feedback.
  autoUpdater.quitAndInstall(false, true);
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
  resetDownloadProgressLogging();
  logUpdate('download_begin', { targetVersion: version, splashAlreadyOpen });

  if (!splashAlreadyOpen && !isUpdateSplashOpen()) {
    openUpdateSplash();
  }
  setUpdateSplashDownloading(version, 0);

  let peakPercent = 0;
  const onProgress = (progress: ProgressInfo): void => {
    const previousPeak = peakPercent;
    const merged = mergeDownloadPercent(peakPercent, progress.percent);
    const percentDropped = progress.percent < previousPeak - 2;
    peakPercent = merged.peakPercent;
    setUpdateSplashDownloading(version, peakPercent, merged.hint);
    logDownloadProgress({
      version,
      percent: progress.percent,
      peakPercent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
      hint: merged.hint,
      ...(percentDropped ? { percentDroppedFrom: previousPeak, rawPercent: progress.percent } : {}),
    });
  };

  autoUpdater.on('download-progress', onProgress);

  try {
    await autoUpdater.downloadUpdate();
    autoUpdater.removeListener('download-progress', onProgress);
    logUpdate('download_complete', { targetVersion: version, peakPercent });

    await installDownloadedUpdate(version);
    await sleep(60_000);
  } catch (err) {
    autoUpdater.removeListener('download-progress', onProgress);
    const message = err instanceof Error ? err.message : String(err);
    logUpdate('error', { stage: 'download', message, stack: err instanceof Error ? err.stack : undefined });
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
    logUpdate('startup_gate', { action: 'skip', reason: 'dev_mode' });
    console.log('[edi-hub] auto-update: dev mode, skipping startup gate');
    return 'continue';
  }

  if (isPostUpdateRelaunch()) {
    consumeInstallHandoff();
    logUpdate('post_update_skip', {
      argv: process.argv,
      pendingWhatsNew: readConfig().pendingWhatsNew,
      appVersion: app.getVersion(),
    });
    console.log('[edi-hub] auto-update: post-update relaunch, skipping startup gate');
    return 'continue';
  }

  configureUpdaterOnce();
  logUpdate('check_begin', { trigger: 'startup_gate', currentVersion: app.getVersion() });
  openUpdateSplash();
  setUpdateSplashChecking(app.getVersion());

  try {
    const result = await autoUpdater.checkForUpdates();
    const remoteVersion = result?.updateInfo?.version;
    logUpdate('check_result', {
      currentVersion: app.getVersion(),
      remoteVersion,
      updateInfo: summarizeUpdateInfo(result?.updateInfo),
    });

    if (!remoteVersion || !isNewerVersion(remoteVersion, app.getVersion())) {
      logUpdate('update_not_available', { currentVersion: app.getVersion(), remoteVersion });
      console.log('[edi-hub] auto-update: already on latest');
      closeUpdateSplash();
      return 'continue';
    }

    logUpdate('update_available', { currentVersion: app.getVersion(), remoteVersion });
    console.log(`[edi-hub] auto-update: v${remoteVersion} available — downloading`);
    await downloadAndInstall(remoteVersion, true);
    return 'continue';
  } catch (err) {
    logUpdate('error', {
      stage: 'startup_gate',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    console.error('[edi-hub] auto-update: startup gate failed:', err);
    closeUpdateSplash();
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
  logUpdate('manual_check', { currentVersion: app.getVersion() });

  try {
    const result = await autoUpdater.checkForUpdates();
    const remoteVersion = result?.updateInfo?.version;
    const current = app.getVersion();

    logUpdate('check_result', {
      trigger: 'manual',
      currentVersion: current,
      remoteVersion,
      updateInfo: summarizeUpdateInfo(result?.updateInfo),
    });

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
    logUpdate('manual_confirm', { remoteVersion, accepted: confirm.response === 0 });
    if (confirm.response !== 0) return;

    await downloadAndInstall(remoteVersion);
  } catch (err) {
    logUpdate('error', {
      stage: 'manual_check',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
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

  logUpdate('whats_new', { version: app.getVersion(), pending });

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
