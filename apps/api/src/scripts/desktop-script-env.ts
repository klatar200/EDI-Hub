/**
 * Apply desktop-install overrides before loadConfig() in operator scripts.
 *
 * Dev `.env` files usually point at Minio/S3. The desktop app stores raw files
 * under `%APPDATA%\EDI Hub\raw` with STORAGE_BACKEND=local. Pass `--desktop`
 * (or set EDI_HUB_USER_DATA_DIR) so scripts talk to the right DB + disk.
 */
import { join } from 'node:path';

function defaultDesktopUserDataDir(): string {
  const fromEnv = process.env.EDI_HUB_USER_DATA_DIR?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.APPDATA) return join(process.env.APPDATA, 'EDI Hub');
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  return join(home, 'AppData', 'Roaming', 'EDI Hub');
}

function looksLikeDesktopDatabaseUrl(url: string): boolean {
  return /:5433\//.test(url) && /edihub/i.test(url);
}

/** True when argv/env indicate the desktop Postgres + local raw store. */
export function isDesktopScriptTarget(argv: readonly string[]): boolean {
  if (argv.includes('--desktop') || process.env.EDI_HUB_DESKTOP === '1') return true;
  if (process.env.EDI_HUB_USER_DATA_DIR?.trim()) return true;
  const db = process.env.DATABASE_URL?.trim();
  return Boolean(db && looksLikeDesktopDatabaseUrl(db));
}

/**
 * Force local storage + desktop paths. Call before `loadConfig()`.
 * When `--desktop` is passed, overrides S3 settings from `.env`.
 */
export function applyDesktopScriptEnv(argv: readonly string[]): boolean {
  if (!isDesktopScriptTarget(argv)) return false;

  const userData = defaultDesktopUserDataDir();
  if (!process.env.DATABASE_URL?.trim()) {
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/edihub';
  }
  process.env.EDI_HUB_USER_DATA_DIR ??= userData;
  process.env.STORAGE_BACKEND = 'local';
  process.env.LOCAL_DATA_DIR = join(userData, 'raw');
  process.env.S3_BUCKET ??= 'unused-local-backend';
  return true;
}
