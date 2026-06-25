/**
 * Desktop track D3 Sprint 1 — LocalStorageAdapter unit tests.
 *
 * Drives the adapter against a temp directory created per-test, with the OS
 * tempdir as the parent. No network, no S3 emulator — verifies the data-
 * path contract: upload writes bytes, download reads them back, buildKey
 * matches the S3 layout, parent dirs are auto-created, path-traversal is
 * blocked, and overwriting an existing key fails loudly.
 *
 * Scorecard coverage:
 *   - S7.1 upload→download round-trip with byte-identical content.
 *   - S7.2 buildKey matches the `raw/YYYY/MM/DD/<id>.edi` pattern emitted
 *     by `buildRawFileKey` in `storage/s3.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

import { LocalStorageAdapter } from '../src/storage/local-adapter.js';
import { buildRawFileKey } from '../src/storage/s3.js';

async function freshDataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'edi-local-adapter-'));
}

function streamFrom(bytes: Buffer): Readable {
  return Readable.from(bytes);
}

// ─────────────────────────────────────────────────────────────
// S7.1 — round-trip
// ─────────────────────────────────────────────────────────────

test('S7.1: upload writes bytes; download reads them back unchanged', async (t) => {
  const dataDir = await freshDataDir();
  t.after(async () => { await rm(dataDir, { recursive: true, force: true }); });
  const adapter = new LocalStorageAdapter({ dataDir });

  const id = randomUUID();
  const key = adapter.buildKey(id, new Date('2026-06-24T12:00:00Z'));
  const original = Buffer.from('ISA*00*          *00*          ~GS*PO*S*R*20260624*1200*1*X*004010~ST*850*0001~SE*1*0001~GE*1*1~IEA*1*000000123~');

  const result = await adapter.upload(key, streamFrom(original));
  assert.equal(result.key, key, 'upload should return the same key');

  const back = await adapter.download(key);
  assert.ok(Buffer.isBuffer(back), 'download should return a Buffer');
  assert.equal(back.length, original.length, 'byte count mismatch on round-trip');
  assert.ok(back.equals(original), 'bytes differ after round-trip');
});

test('S7.1: upload creates the date-partitioned subdirectories on demand', async (t) => {
  const dataDir = await freshDataDir();
  t.after(async () => { await rm(dataDir, { recursive: true, force: true }); });
  const adapter = new LocalStorageAdapter({ dataDir });

  const key = adapter.buildKey('test-id', new Date('2030-01-15T00:00:00Z'));
  await adapter.upload(key, streamFrom(Buffer.from('payload')));

  // The deeply nested file should now exist exactly where the key says.
  const onDisk = await readFile(join(dataDir, key));
  assert.equal(onDisk.toString(), 'payload');
});

// ─────────────────────────────────────────────────────────────
// S7.2 — buildKey matches the S3 layout
// ─────────────────────────────────────────────────────────────

test('S7.2: buildKey emits the same raw/YYYY/MM/DD/<id>.edi pattern as the S3 helper', () => {
  const dataDir = '/anywhere';
  const adapter = new LocalStorageAdapter({ dataDir });
  const id = 'abc-123';
  const at = new Date('2026-06-24T08:30:00Z');
  const fromAdapter = adapter.buildKey(id, at);
  const fromS3Helper = buildRawFileKey(id, at);
  assert.equal(fromAdapter, fromS3Helper);
  assert.equal(fromAdapter, 'raw/2026/06/24/abc-123.edi');
});

test('S7.2: buildKey defaults ingestedAt to "now" when omitted', () => {
  const adapter = new LocalStorageAdapter({ dataDir: '/tmp' });
  const id = 'x';
  const before = new Date();
  const k = adapter.buildKey(id);
  const after = new Date();
  // Crude bound: the day in the key should be one of the days we crossed.
  const match = /^raw\/(\d{4})\/(\d{2})\/(\d{2})\/x\.edi$/.exec(k);
  assert.ok(match, `key did not match expected pattern: ${k}`);
  const yyyy = Number(match![1]);
  assert.ok(
    yyyy === before.getUTCFullYear() || yyyy === after.getUTCFullYear(),
    `year ${yyyy} did not match invocation window`,
  );
});

// ─────────────────────────────────────────────────────────────
// Safety: collisions and path traversal
// ─────────────────────────────────────────────────────────────

test('uploading the same key twice fails loudly — raw file is sacred', async (t) => {
  const dataDir = await freshDataDir();
  t.after(async () => { await rm(dataDir, { recursive: true, force: true }); });
  const adapter = new LocalStorageAdapter({ dataDir });

  const key = adapter.buildKey('collide');
  await adapter.upload(key, streamFrom(Buffer.from('first')));

  await assert.rejects(
    () => adapter.upload(key, streamFrom(Buffer.from('second'))),
    /EEXIST/i,
    'overwrite must be refused; collision means an upstream bug',
  );

  // Original bytes must still be on disk.
  const back = await adapter.download(key);
  assert.equal(back.toString(), 'first');
});

test('a key with .. in it cannot escape dataDir', async (t) => {
  const dataDir = await freshDataDir();
  t.after(async () => { await rm(dataDir, { recursive: true, force: true }); });
  const adapter = new LocalStorageAdapter({ dataDir });

  // Plant a file outside dataDir that an attacker might try to read.
  const sibling = join(dataDir, '..', 'forbidden.txt');
  await mkdir(join(dataDir, '..'), { recursive: true });
  await writeFile(sibling, 'secret');
  t.after(async () => { await rm(sibling, { force: true }); });

  await assert.rejects(
    () => adapter.download(`..${sep}forbidden.txt`),
    /resolves outside the configured dataDir/,
    'download must refuse path-traversal keys',
  );
  await assert.rejects(
    () => adapter.upload(`..${sep}escape.edi`, streamFrom(Buffer.from('nope'))),
    /resolves outside the configured dataDir/,
    'upload must refuse path-traversal keys',
  );
});

test('download throws ENOENT for a missing key (no silent empty buffer)', async (t) => {
  const dataDir = await freshDataDir();
  t.after(async () => { await rm(dataDir, { recursive: true, force: true }); });
  const adapter = new LocalStorageAdapter({ dataDir });

  await assert.rejects(
    () => adapter.download(adapter.buildKey('nope-not-here')),
    /ENOENT/,
    'a missing key must surface as a real ENOENT, not an empty buffer',
  );
});

// ─────────────────────────────────────────────────────────────
// Streaming
// ─────────────────────────────────────────────────────────────

test('upload accepts a generator-driven Readable (no full buffering required)', async (t) => {
  const dataDir = await freshDataDir();
  t.after(async () => { await rm(dataDir, { recursive: true, force: true }); });
  const adapter = new LocalStorageAdapter({ dataDir });

  // 64KB written in 1KB chunks via a sync generator.
  function* chunks() {
    const chunk = Buffer.alloc(1024, 0xab);
    for (let i = 0; i < 64; i += 1) yield chunk;
  }
  const stream = Readable.from(chunks());

  const key = adapter.buildKey('stream-test');
  await adapter.upload(key, stream);

  const back = await adapter.download(key);
  assert.equal(back.length, 64 * 1024);
  assert.ok(back.every((b) => b === 0xab), 'streamed bytes did not match the source');
});
