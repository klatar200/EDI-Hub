/**
 * D9 Sprint 1 — backup archive format (pgdata + raw).
 *
 * `embedded-postgres` ships only `postgres`, `initdb`, and `pg_ctl` — not
 * `pg_dump` / `pg_restore`. For a single-machine embedded cluster the
 * safe approach is a cold copy of the data directory while Postgres is
 * stopped, bundled with the raw EDI file tree.
 */
import { createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import archiver from 'archiver';
import extract from 'extract-zip';

export const BACKUP_FORMAT_VERSION = 1;

export interface BackupManifest {
  formatVersion: number;
  appVersion: string;
  createdAt: string;
  database: string;
}

export interface BackupPaths {
  userDataDir: string;
  pgdataDir: string;
  rawDir: string;
}

export function backupPaths(userDataDir: string): BackupPaths {
  return {
    userDataDir,
    pgdataDir: join(userDataDir, 'pgdata'),
    rawDir: join(userDataDir, 'raw'),
  };
}

function timestampForFilename(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

export function defaultBackupFilename(now = new Date()): string {
  return `edi-hub-backup-${timestampForFilename(now)}.zip`;
}

async function assertBackupSources(paths: BackupPaths): Promise<void> {
  if (!existsSync(join(paths.pgdataDir, 'PG_VERSION'))) {
    throw new Error('Postgres data directory is missing — has the app finished its first launch?');
  }
  await mkdir(paths.rawDir, { recursive: true });
}

export async function createBackupZip(input: {
  paths: BackupPaths;
  destZipPath: string;
  appVersion: string;
  now?: Date;
}): Promise<BackupManifest> {
  const now = input.now ?? new Date();
  await assertBackupSources(input.paths);

  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: input.appVersion,
    createdAt: now.toISOString(),
    database: 'edihub',
  };

  const stagingDir = join(input.paths.userDataDir, '.backup-staging');
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  const manifestPath = join(stagingDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(input.destZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    output.on('error', reject);
    archive.pipe(output);
    archive.file(manifestPath, { name: 'manifest.json' });
    archive.directory(input.paths.pgdataDir, 'pgdata');
    archive.directory(input.paths.rawDir, 'raw');
    void archive.finalize();
  });

  await rm(stagingDir, { recursive: true, force: true });
  return manifest;
}

export async function extractBackupZip(zipPath: string, destDir: string): Promise<BackupManifest> {
  await mkdir(destDir, { recursive: true });
  await extract(zipPath, { dir: destDir });
  const manifestPath = join(destDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('Backup is missing manifest.json.');
  }
  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw) as BackupManifest;
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup format version ${String(manifest.formatVersion)}.`);
  }
  if (!existsSync(join(destDir, 'pgdata', 'PG_VERSION'))) {
    throw new Error('Backup is missing a valid pgdata directory.');
  }
  return manifest;
}

async function copyTreeReplacing(src: string, dest: string): Promise<void> {
  await rm(dest, { recursive: true, force: true });

  async function copyRecursive(from: string, to: string): Promise<void> {
    const st = await stat(from);
    if (st.isDirectory()) {
      await mkdir(to, { recursive: true });
      const entries = await readdir(from, { withFileTypes: true });
      for (const entry of entries) {
        await copyRecursive(join(from, entry.name), join(to, entry.name));
      }
      return;
    }
    await mkdir(join(to, '..'), { recursive: true });
    await copyFile(from, to);
  }

  await copyRecursive(src, dest);
}

/** Replace live pgdata + raw from an extracted backup directory. */
export async function applyExtractedBackup(extractedDir: string, paths: BackupPaths): Promise<void> {
  const pgSrc = join(extractedDir, 'pgdata');
  const rawSrc = join(extractedDir, 'raw');
  if (!existsSync(pgSrc)) throw new Error('Extracted backup is missing pgdata/.');
  await copyTreeReplacing(pgSrc, paths.pgdataDir);
  if (existsSync(rawSrc)) {
    await copyTreeReplacing(rawSrc, paths.rawDir);
  } else {
    await mkdir(paths.rawDir, { recursive: true });
  }
}

export async function listRegularFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listRegularFiles(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}
