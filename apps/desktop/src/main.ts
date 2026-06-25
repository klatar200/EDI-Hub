/**
 * Desktop track D4 Sprint 1 — Electron main process.
 *
 * Boots the local stack in the strict order documented in
 * DESKTOP_SPRINT_PLAN.md D4 Sprint 1:
 *
 *   1. Start the embedded Postgres binary on port 5433.
 *      - Extract / initdb on first launch (cached after).
 *      - Poll `pg_isready` (TCP probe) for up to 15s.
 *   2. Apply Prisma migrations (`prisma migrate deploy`).
 *   3. Spawn the compiled Fastify API as a child process with
 *      `DATABASE_URL`, `STORAGE_BACKEND=local`, `LOCAL_DATA_DIR`,
 *      `JOB_BACKEND=db`, `PORT` set in its env.
 *   4. Poll `GET http://127.0.0.1:<api-port>/health` for up to 10s.
 *   5. Open the BrowserWindow.
 *
 * On quit (window close / SIGINT / SIGTERM):
 *   - Close the window cleanly.
 *   - SIGTERM the API child and await its exit.
 *   - Stop Postgres.
 *   - Never leave orphan child processes.
 *
 * If the API child exits unexpectedly after the boot succeeded, we restart
 * it once before showing an error dialog.
 *
 * NOTE: This is the Sprint 1 milestone — the window just loads whatever
 * `apps/web` is serving (Vite in dev, the bundled build in production).
 * D4 Sprint 3 ships the splash + native menus.
 */
import { app, BrowserWindow, dialog, type Event as ElectronEvent } from 'electron';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { closeSplash, openSplash, updateSplash } from './splash.js';
import { installApplicationMenu } from './menu.js';
import { consumePendingWhatsNew, initAutoUpdater } from './auto-update.js';
import { enforceLicenseGate } from './license-window.js';
import { registerDesktopRuntime, clearDesktopRuntime } from './desktop-runtime.js';

// Electron resolves `app.getPath('userData')` from `app.getName()`, which
// defaults to package.json `name` (`@edi/desktop`) — NOT electron-builder's
// `productName`. Without this, Windows data lands in a non-obvious folder
// (e.g. under a scoped npm name) instead of `%APPDATA%\EDI Hub`.
app.setName('EDI Hub');

// D4 Sprint 3 — cold-start timing baseline.
const launchTs = Date.now();
// `embedded-postgres` ships as ESM-only. CommonJS modules can't statically
// import it, so we use a deferred `import()` inside startPostgres(). We
// describe only the methods we actually call to avoid pulling the package's
// types across the CJS<->ESM boundary (Node16 module-resolution would
// otherwise require a `resolution-mode` attribute on the typeof alias).
interface EmbeddedPostgresInstance {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  createDatabase(name: string): Promise<void>;
}

/** Electron extends Node's process with `resourcesPath` only when the app
 *  is packaged. The type lives in `electron` but isn't reflected on Node's
 *  built-in `Process` interface. Cast through a typed helper. */
const procRes: string = (process as unknown as { resourcesPath?: string }).resourcesPath ?? '';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const PG_PORT = 5433;
const PG_USER = 'postgres';
const PG_PASSWORD = 'postgres';
const PG_DATABASE = 'edihub';
// D4 Sprint 2 — fixed port 3000. The same process serves the API at
// `/api/*` and the React build at `/`, so LAN clients reach the hub with
// a single `http://<server-ip>:3000` URL. The plan documents this as the
// canonical install port; the Sprint 1 choice of 3100 (avoiding collision
// with a parallel `npm run -w @edi/api dev`) is now superseded.
const API_PORT = 3000;
const PG_READY_TIMEOUT_MS = 15_000;
// Cold-start budget for the API child. The Fastify app loads Prisma, the
// AWS SDK (storage/factory.ts imports both adapters at module level — even
// with STORAGE_BACKEND=local the S3 SDK is required, which is a multi-second
// disk read on first launch), and registers ~a dozen plugins before binding.
// Real-world observed cold start on Windows: ~12-15s. We allow 45s as a
// generous ceiling; D4 Sprint 3 will tighten this via lazy-import of the
// S3 SDK and a measured cold-start budget.
const API_READY_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 500;

// ─────────────────────────────────────────────────────────────
// Path resolution
// ─────────────────────────────────────────────────────────────

/**
 * Where the API entrypoint lives. Resolved via Node's require lookup in
 * BOTH dev and packaged mode — the desktop package.json declares
 * `@edi/api` as a workspace dep, so Node finds it in the workspace
 * symlink during dev and in the packaged `resources/app/node_modules`
 * tree (asar disabled, see electron-builder.yml).
 */
function resolveApiEntry(): string {
  return require.resolve('@edi/api/dist/src/index.js');
}

/**
 * Absolute path to the Prisma CLI script. `prisma` is a transitive
 * production dep, present in the packaged node_modules. We spawn it
 * with `process.execPath` + `ELECTRON_RUN_AS_NODE=1` so a single
 * binary serves as both the Electron host and the Node interpreter
 * for the migrate-deploy child.
 */
function resolvePrismaCli(): string {
  return require.resolve('prisma/build/index.js');
}

function resolveWebUrl(): string {
  // D4 Sprint 2 — Electron points the renderer at the local API server,
  // which serves the React build at `/`. Same URL for dev and packaged.
  // LAN browsers reach the same content at `http://<server-ip>:3000`.
  //
  // Devs who want Vite hot-reload during UI iteration can override:
  //   set EDI_DESKTOP_RENDERER_URL=http://localhost:5173
  //   npm run dev -w @edi/web    # in a second terminal
  // The CORS plugin will activate when CORS_ALLOWED_ORIGINS is set; the
  // override path is documented in apps/desktop/README.md.
  const override = process.env.EDI_DESKTOP_RENDERER_URL;
  if (override && override.length > 0) return override;
  return `http://127.0.0.1:${API_PORT}`;
}

/**
 * Where the built React app lives. The API child registers it under
 * @fastify/static when this path is set in its env.
 *   - Packaged: `procRes/web/dist`     (D6 will wire extraResources).
 *   - Dev:      `../../apps/web/dist`  built by `npm run build -w @edi/web`.
 */
function resolveWebStaticDir(): string {
  if (app.isPackaged) return join(procRes, 'web', 'dist');
  const here = __dirname;
  return resolve(here, '..', '..', 'web', 'dist');
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

// ─────────────────────────────────────────────────────────────
// Postgres lifecycle
// ─────────────────────────────────────────────────────────────

let pg: EmbeddedPostgresInstance | null = null;

async function startPostgres(): Promise<{ databaseUrl: string }> {
  const userData = app.getPath('userData');
  const dataDir = join(userData, 'pgdata');
  ensureDir(dataDir);

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
    // Force UTF8 + C locale on the cluster's template databases. Without
    // this, `initdb` picks up Windows's default WIN1252 locale, and any
    // migration containing a non-ASCII character (we have ~12 — arrows,
    // em-dashes, smart quotes in comments) fails at apply time with
    // `character ... has no equivalent in encoding "WIN1252"`. UTF8 also
    // matches what cloud/dev Postgres uses everywhere else in the project,
    // so the desktop install is byte-identical to managed Postgres.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  // `embedded-postgres@17.10.0-beta.17`'s `initialise()` runs `initdb`
  // unconditionally — it does NOT short-circuit when a data dir already
  // exists. A second launch (or any launch after a crash that left files
  // behind) would fail with "directory exists but is not empty". Gate the
  // call ourselves using Postgres's canonical "this is a data dir" marker:
  // the `PG_VERSION` file is the first thing initdb writes and the only
  // reliable signal that a dir is a real Postgres cluster.
  //
  // First launch (no PG_VERSION yet) runs initdb — 30-90s on Windows.
  // Subsequent launches skip straight to start().
  const pgVersionFile = join(dataDir, 'PG_VERSION');
  if (!existsSync(pgVersionFile)) {
    await pg.initialise();
  }
  await pg.start();

  // Belt-and-suspenders TCP probe: the start() promise should resolve only
  // after Postgres accepts connections, but we wait for an actual TCP handshake
  // before declaring victory.
  await waitForTcp('127.0.0.1', PG_PORT, PG_READY_TIMEOUT_MS, 'Postgres');

  // Ensure the `edihub` database exists. embedded-postgres only creates the
  // `postgres` superuser/database by default; we need our own.
  await ensureDatabase(PG_DATABASE);

  return {
    databaseUrl: `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DATABASE}`,
  };
}

async function ensureDatabase(name: string): Promise<void> {
  if (!pg) throw new Error('ensureDatabase called before Postgres start');
  // embedded-postgres exposes a `createDatabase` shortcut. Tolerate "already
  // exists" so reruns are no-ops.
  try {
    await pg.createDatabase(name);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (!/already exists/i.test(msg)) throw err;
  }
}

async function stopPostgres(): Promise<void> {
  if (!pg) return;
  try {
    await pg.stop();
  } catch (err) {
    console.error('Postgres stop error (continuing shutdown):', err);
  } finally {
    pg = null;
  }
}

// ─────────────────────────────────────────────────────────────
// Prisma migrate deploy
// ─────────────────────────────────────────────────────────────

async function runMigrations(databaseUrl: string): Promise<void> {
  const here = __dirname;
  // Packaged: the schema lives in extraResources at
  //   `procRes/prisma/schema.prisma` (see electron-builder.yml).
  // Dev: the workspace tree has it at
  //   `packages/db/prisma/schema.prisma`.
  const schemaPath = app.isPackaged
    ? join(procRes, 'prisma', 'schema.prisma')
    : resolve(here, '..', '..', '..', 'packages', 'db', 'prisma', 'schema.prisma');

  // require.resolve gives us an absolute path to the Prisma CLI in both
  // dev (the hoisted root node_modules) and packaged (the unpacked app
  // node_modules) modes — no need to second-guess cwd.
  const prismaCli = resolvePrismaCli();

  await new Promise<void>((resolveProm, rejectProm) => {
    const child = spawn(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', schemaPath],
      {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          // ELECTRON_RUN_AS_NODE makes the Electron binary behave like
          // Node when spawned as a child. Without it the CLI never
          // executes — the child just opens (and closes) a stray
          // Electron window, hence the silent hang we hit in Sprint 1.
          // eslint-disable-next-line @typescript-eslint/naming-convention
          ELECTRON_RUN_AS_NODE: '1',
        },
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    child.once('exit', (code) => {
      if (code === 0) resolveProm();
      else rejectProm(new Error(`prisma migrate deploy exited with code ${code}`));
    });
    child.once('error', rejectProm);
  });
}

// ─────────────────────────────────────────────────────────────
// API child process
// ─────────────────────────────────────────────────────────────

let apiChild: ChildProcess | null = null;
let restartedOnce = false;
let currentApiEnv: Record<string, string> | null = null;

async function startApiChild(env: Record<string, string>): Promise<void> {
  const entry = resolveApiEntry();
  if (!existsSync(entry)) {
    throw new Error(
      `API entry not found at ${entry}. ` +
        'Run `npm run build -w @edi/api` (dev) or check electron-builder extraResources (packaged).',
    );
  }
  apiChild = spawn(process.execPath, [entry], {
    env: { ...process.env, ...env },
    stdio: 'inherit',
    windowsHide: true,
  });

  apiChild.once('exit', (code, signal) => {
    const prior = apiChild;
    apiChild = null;
    // Only restart on UNEXPECTED exits after the window is open. A SIGTERM
    // from our own shutdown path is expected.
    if (signal === 'SIGTERM' || signal === 'SIGINT') return;
    console.error(`API child exited unexpectedly (code=${code}, signal=${signal})`);
    if (!restartedOnce && BrowserWindow.getAllWindows().length > 0) {
      restartedOnce = true;
      console.log('Restarting API child once...');
      void startApiChild(env).catch((err) => console.error('Restart failed:', err));
    } else if (BrowserWindow.getAllWindows().length > 0) {
      dialog.showErrorBox('EDI Hub crashed', 'The API service exited and could not be restarted.');
    }
    void prior; // silence unused
  });

  await waitForHttp200(`http://127.0.0.1:${env.PORT}/health`, API_READY_TIMEOUT_MS, 'API');
  console.log(`API ready on port ${env.PORT}`);
}

async function stopApiChild(): Promise<void> {
  if (!apiChild) return;
  return new Promise<void>((resolveProm) => {
    apiChild!.once('exit', () => resolveProm());
    apiChild!.kill('SIGTERM');
  });
}

// ─────────────────────────────────────────────────────────────
// Polling helpers
// ─────────────────────────────────────────────────────────────

async function waitForTcp(host: string, port: number, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolveProm) => {
      const sock = connect({ host, port });
      sock.once('connect', () => { sock.end(); resolveProm(true); });
      sock.once('error', (err) => { lastErr = err; resolveProm(false); });
    });
    if (ok) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`${label} did not accept TCP on ${host}:${port} within ${timeoutMs}ms (last error: ${String(lastErr)})`);
}

async function waitForHttp200(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`${label} did not return HTTP 200 from ${url} within ${timeoutMs}ms (last error: ${String(lastErr)})`);
}

// ─────────────────────────────────────────────────────────────
// Window
// ─────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

async function openMainWindow(): Promise<void> {
  const here = __dirname;
  const preloadPath = join(here, 'preload.js');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // shown after the renderer loads to avoid the flash of unstyled chrome
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload uses contextBridge; sandbox: true would block the require we use
      preload: preloadPath,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.once('closed', () => { mainWindow = null; });
  // D4 Sprint 3 — close the splash and report S10.1 the moment the
  // renderer has the dashboard painted. did-finish-load fires after
  // the React bundle has executed and the initial route has rendered;
  // it's the most user-visible signal that the app is "ready."
  mainWindow.webContents.once('did-finish-load', () => {
    const elapsed = Date.now() - launchTs;
    console.log(`[edi-hub] cold-start ${elapsed}ms (firstLaunch=${isFirstLaunch})`);
    closeSplash();
    // D7 Sprint 1 — kick off the silent background update check and
    // surface the "What's new" dialog if a prior launch finished
    // applying an update. Both are no-ops in dev mode.
    void consumePendingWhatsNew();
    initAutoUpdater();
  });
  await mainWindow.loadURL(resolveWebUrl());
}

// ─────────────────────────────────────────────────────────────
// Boot orchestration
// ─────────────────────────────────────────────────────────────

/**
 * Is this the first time the app has been launched on this machine?
 * Detected by the absence of the Postgres data dir's `PG_VERSION` file
 * (the same gate startPostgres() uses to skip `initdb`). Read once at
 * boot time so the splash UI chooses the right mode and stays
 * consistent through the whole launch.
 */
let isFirstLaunch = false;

function detectFirstLaunch(): boolean {
  const dataDir = join(app.getPath('userData'), 'pgdata');
  return !existsSync(join(dataDir, 'PG_VERSION'));
}

async function boot(): Promise<void> {
  console.log('[edi-hub] boot step 1: starting embedded Postgres...');
  updateSplash('postgres', 'running');
  const { databaseUrl } = await startPostgres();
  updateSplash('postgres', 'done');

  console.log('[edi-hub] boot step 2: running prisma migrate deploy...');
  updateSplash('migrate', 'running');
  await runMigrations(databaseUrl);
  updateSplash('migrate', 'done');

  console.log('[edi-hub] boot step 3: spawning API child...');
  updateSplash('api', 'running');
  const userData = app.getPath('userData');
  const rawDir = join(userData, 'raw');
  ensureDir(rawDir);
  // D4 Sprint 2 — the API process serves the React build at `/` so we
  // pass it the absolute path to apps/web/dist. The desktop dev script
  // ensures it exists by running `npm run build -w @edi/web` first.
  const webStaticDir = resolveWebStaticDir();
  // For the Vite-hot-reload override path, the developer may have set
  // CORS_ALLOWED_ORIGINS already (renderer is on :5173, API on :3000 —
  // cross-origin again). Honor whatever's in process.env so dev tools
  // can opt into that mode without code changes.
  const apiEnv: Record<string, string> = {
    DATABASE_URL: databaseUrl,
    DATABASE_PROVIDER: 'postgresql',
    STORAGE_BACKEND: 'local',
    LOCAL_DATA_DIR: rawDir,
    JOB_BACKEND: 'db',
    PORT: String(API_PORT),
    // Bucket name is unused on local storage backend but config.ts requires it.
    S3_BUCKET: 'unused-local-backend',
    NODE_ENV: 'production',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    WEB_STATIC_DIR: webStaticDir,
    // See the matching comment in runMigrations: Electron-as-child must run
    // in Node mode or it opens a window instead of executing the script.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    ELECTRON_RUN_AS_NODE: '1',
  };
  if (process.env.CORS_ALLOWED_ORIGINS) {
    apiEnv.CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS;
  }
  currentApiEnv = apiEnv;
  await startApiChild(apiEnv);
  updateSplash('api', 'done');

  console.log('[edi-hub] boot step 5: opening BrowserWindow...');
  updateSplash('window', 'running');
  await openMainWindow();

  registerDesktopRuntime({
    userDataDir: userData,
    appVersion: app.getVersion(),
    stopApi: stopApiChild,
    startApi: async () => {
      if (!currentApiEnv) throw new Error('API environment is not initialized.');
      await startApiChild(currentApiEnv);
    },
    stopPostgres,
    startPostgresStack: async () => {
      const { databaseUrl } = await startPostgres();
      await runMigrations(databaseUrl);
    },
    reloadMainWindow: async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.loadURL(resolveWebUrl());
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Quit lifecycle
// ─────────────────────────────────────────────────────────────

let isShuttingDown = false;
async function shutdown(reason: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[edi-hub] shutdown: ${reason}`);
  clearDesktopRuntime();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  await stopApiChild();
  await stopPostgres();
}

app.whenReady().then(async () => {
  try {
    installApplicationMenu();
    // D8 Sprint 1 — trial / license gate before Postgres or API boot.
    const allowed = await enforceLicenseGate(app.getPath('userData'));
    if (!allowed) {
      app.quit();
      return;
    }
    // Detect first launch BEFORE startPostgres() runs initdb. The
    // PG_VERSION file appears as soon as initdb succeeds, so checking
    // afterwards would always read "subsequent launch."
    isFirstLaunch = detectFirstLaunch();
    openSplash(isFirstLaunch);
    console.log(`[edi-hub] launch detected: firstLaunch=${isFirstLaunch}`);
    console.log(`[edi-hub] userData: ${app.getPath('userData')}`);
    await boot();
  } catch (err) {
    console.error('Fatal boot error:', err);
    closeSplash();
    dialog.showErrorBox('EDI Hub failed to start', (err as Error).message);
    await shutdown('boot-failure');
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  await shutdown('window-all-closed');
  app.quit();
});

app.on('before-quit', async (event: ElectronEvent) => {
  if (isShuttingDown) return;
  event.preventDefault();
  await shutdown('before-quit');
  app.exit(0);
});

process.on('SIGINT', () => void shutdown('SIGINT').then(() => app.exit(0)));
process.on('SIGTERM', () => void shutdown('SIGTERM').then(() => app.exit(0)));
