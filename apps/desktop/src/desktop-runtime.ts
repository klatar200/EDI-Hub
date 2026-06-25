/**
 * D9 Sprint 1 — shared runtime hooks registered by main.ts after boot.
 * Backup/restore stops and restarts the API + Postgres without quitting the app.
 */
export interface DesktopRuntime {
  userDataDir: string;
  appVersion: string;
  stopApi: () => Promise<void>;
  startApi: () => Promise<void>;
  stopPostgres: () => Promise<void>;
  /** Start Postgres and apply pending migrations. */
  startPostgresStack: () => Promise<void>;
  reloadMainWindow: () => Promise<void>;
}

let runtime: DesktopRuntime | null = null;

export function registerDesktopRuntime(next: DesktopRuntime): void {
  runtime = next;
}

export function getDesktopRuntime(): DesktopRuntime {
  if (!runtime) {
    throw new Error('Desktop runtime is not ready yet — wait until the app has finished booting.');
  }
  return runtime;
}

export function clearDesktopRuntime(): void {
  runtime = null;
}
