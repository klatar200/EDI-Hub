/**
 * Desktop track D3 Sprint 1 — raw-file storage interface.
 *
 * The hub treats the raw EDI transmission as sacred — it must be persisted
 * verbatim before any parsing. Two backends share this interface:
 *
 *   - `s3-adapter.ts`   — production / SaaS. AWS S3 (or MinIO in dev) with
 *                         versioning + SSE-S3 at rest.
 *   - `local-adapter.ts` — desktop installer / local dev. Plain filesystem
 *                         under `<dataDir>/raw/`.
 *
 * `factory.ts` picks one at boot via `STORAGE_BACKEND`. Routes / services
 * only ever hold a `StorageAdapter` reference — they never reach for an
 * `S3Client` or `fs` themselves.
 *
 * The interface matches the literal in DESKTOP_SPRINT_PLAN.md D3 Sprint 1
 * step 1. Implementation notes:
 *   - `upload` accepts a Node ReadableStream. Both backends stream rather
 *     than buffer so large files are safe.
 *   - `download` returns the full bytes as a Buffer. The current call sites
 *     (`raw-files.ts`, `parsing.ts`) already expect this shape.
 *   - `buildKey` produces the same date-partitioned path on both backends
 *     so an operator inspecting `<dataDir>/raw/2026/06/24/<id>.edi` sees a
 *     layout familiar from S3 console screenshots.
 */

import type { Readable } from 'node:stream';

export interface StorageAdapter {
  /**
   * Stream `body` to the backing store under `key`. Returns the same key so
   * callers can chain (or audit) it without re-deriving.
   */
  upload(
    key: string,
    body: Readable,
    contentType?: string,
  ): Promise<{ key: string }>;

  /** Return the full bytes stored at `key`. */
  download(key: string): Promise<Buffer>;

  /**
   * Produce the canonical key for a new raw file. Both backends use the
   * same `raw/YYYY/MM/DD/<id>.edi` layout so the DB's `s3Key` column is
   * meaningful regardless of where the bytes physically live.
   */
  buildKey(id: string, ingestedAt?: Date): string;
}
