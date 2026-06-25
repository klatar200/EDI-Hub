/**
 * D9 Sprint 1 — backup archive round-trip tests.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  applyExtractedBackup,
  backupPaths,
  createBackupZip,
  extractBackupZip,
  listRegularFiles,
} from '../src/backup-core.js';

describe('backup-core', () => {
  it('creates a zip with manifest, pgdata, and raw', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edi-backup-src-'));
    const destRoot = await mkdtemp(join(tmpdir(), 'edi-backup-dest-'));
    const zipPath = join(destRoot, 'test-backup.zip');
    try {
      const paths = backupPaths(root);
      await mkdir(paths.pgdataDir, { recursive: true });
      await mkdir(paths.rawDir, { recursive: true });
      await writeFile(join(paths.pgdataDir, 'PG_VERSION'), '17\n', 'utf8');
      await writeFile(join(paths.rawDir, 'sample.edi'), 'ISA*00*', 'utf8');

      const manifest = await createBackupZip({
        paths,
        destZipPath: zipPath,
        appVersion: '0.0.9-alpha',
        now: new Date('2026-06-25T12:00:00.000Z'),
      });
      assert.equal(manifest.formatVersion, 1);

      const extracted = await mkdtemp(join(tmpdir(), 'edi-backup-extract-'));
      try {
        const parsed = await extractBackupZip(zipPath, extracted);
        assert.equal(parsed.database, 'edihub');
        assert.ok(await readFile(join(extracted, 'manifest.json'), 'utf8'));
        assert.ok(await readFile(join(extracted, 'pgdata', 'PG_VERSION'), 'utf8'));
        assert.equal(await readFile(join(extracted, 'raw', 'sample.edi'), 'utf8'), 'ISA*00*');
      } finally {
        await rm(extracted, { recursive: true, force: true });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(destRoot, { recursive: true, force: true });
    }
  });

  it('restores pgdata and raw into a live userData tree', async () => {
    const src = await mkdtemp(join(tmpdir(), 'edi-backup-src2-'));
    const live = await mkdtemp(join(tmpdir(), 'edi-backup-live-'));
    const work = await mkdtemp(join(tmpdir(), 'edi-backup-work-'));
    const zipPath = join(work, 'roundtrip.zip');
    try {
      const srcPaths = backupPaths(src);
      await mkdir(srcPaths.pgdataDir, { recursive: true });
      await mkdir(srcPaths.rawDir, { recursive: true });
      await writeFile(join(srcPaths.pgdataDir, 'PG_VERSION'), '17\n', 'utf8');
      await writeFile(join(srcPaths.rawDir, 'po.edi'), 'PO123', 'utf8');
      await createBackupZip({
        paths: srcPaths,
        destZipPath: zipPath,
        appVersion: '0.0.9-alpha',
      });

      const livePaths = backupPaths(live);
      await mkdir(join(livePaths.pgdataDir), { recursive: true });
      await writeFile(join(livePaths.pgdataDir, 'PG_VERSION'), 'OLD\n', 'utf8');
      await mkdir(livePaths.rawDir, { recursive: true });
      await writeFile(join(livePaths.rawDir, 'stale.edi'), 'gone', 'utf8');

      const extracted = join(work, 'extracted');
      await extractBackupZip(zipPath, extracted);
      await applyExtractedBackup(extracted, livePaths);

      assert.equal(await readFile(join(livePaths.pgdataDir, 'PG_VERSION'), 'utf8'), '17\n');
      const rawFiles = await listRegularFiles(livePaths.rawDir);
      assert.ok(rawFiles.some((p) => p.endsWith('po.edi')));
      assert.ok(!rawFiles.some((p) => p.endsWith('stale.edi')));
    } finally {
      await rm(src, { recursive: true, force: true });
      await rm(live, { recursive: true, force: true });
      await rm(work, { recursive: true, force: true });
    }
  });
});
