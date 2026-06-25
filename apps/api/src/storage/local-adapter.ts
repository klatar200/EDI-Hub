/**
 * Desktop track D3 Sprint 1 — local-filesystem storage adapter.
 *
 * Writes raw EDI files under `<dataDir>/raw/<key>`, where `<key>` is the
 * same date-partitioned layout the S3 adapter uses
 * (`raw/YYYY/MM/DD/<id>.edi`). The desktop installer points `dataDir` at
 * `<userData>/raw/`; local dev defaults to `<HOME>/.edi-hub/`.
 *
 * Design notes:
 *   - `upload` streams via `pipeline` so files larger than free RAM are
 *     safe (matches the S3 adapter's `lib-storage` behavior).
 *   - Parent directories are created on first write per (year, month, day).
 *     Cheap on local FS; no setup required at install time.
 *   - `download` reads the whole file into a Buffer because that's what the
 *     existing call sites (`raw-files.ts`, `parsing.ts`) consume.
 *   - "Raw file is sacred." Once written, we never overwrite — the DB's
 *     dedup-on-ISA-control-number plus the `<id>` suffix in the key make
 *     name collisions impossible in practice. If a path somehow already
 *     exists, we fail loudly rather than silently clobbering.
 */
import { promises as fsp, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { StorageAdapter } from './interface.js';

export interface LocalStorageOptions {
  /** Filesystem root the adapter writes under. The plan's `<dataDir>`. */
  dataDir: string;
}

export class LocalStorageAdapter implements StorageAdapter {
  private readonly dataDir: string;

  constructor(opts: LocalStorageOptions) {
    // Normalise once so all subsequent path math is predictable. Absolute
    // path also makes the `escape-the-dataDir` guard in `resolveKey()` work.
    this.dataDir = resolve(opts.dataDir);
  }

  async upload(key: string, body: Readable, _contentType?: string): Promise<{ key: string }> {
    const absPath = this.resolveKey(key);
    await fsp.mkdir(dirname(absPath), { recursive: true });
    // wx = exclusive: fail if the file already exists. Raw is sacred; an
    // unexpected collision is a bug we want to see immediately.
    const out = createWriteStream(absPath, { flags: 'wx' });
    await pipeline(body, out);
    return { key };
  }

  async download(key: string): Promise<Buffer> {
    const absPath = this.resolveKey(key);
    return fsp.readFile(absPath);
  }

  buildKey(id: string, ingestedAt: Date = new Date()): string {
    const yyyy = ingestedAt.getUTCFullYear();
    const mm = String(ingestedAt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(ingestedAt.getUTCDate()).padStart(2, '0');
    return `raw/${yyyy}/${mm}/${dd}/${id}.edi`;
  }

  /**
   * Resolve a key relative to `dataDir`, refusing any value that would
   * escape the directory (`..`, absolute paths, drive letters on Windows).
   * The dedup logic upstream means real keys never look like that — this
   * is the defense-in-depth check for an attacker-controlled column write
   * we haven't anticipated.
   */
  private resolveKey(key: string): string {
    const candidate = resolve(join(this.dataDir, key));
    // Path traversal guard: the resolved path must live under dataDir.
    const root = this.dataDir.endsWith(sep) ? this.dataDir : this.dataDir + sep;
    if (candidate !== this.dataDir && !candidate.startsWith(root)) {
      throw new Error(`Storage key '${key}' resolves outside the configured dataDir`);
    }
    return candidate;
  }
}
