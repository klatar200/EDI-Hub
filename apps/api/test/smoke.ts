/**
 * Sprint 1 smoke test (runnable end-to-end).
 *
 * Verifies the full ingestion path against a real local Postgres + MinIO:
 *   1. POST a synthetic 850 to /ingest/upload  -> expect 200 + an id
 *   2. The object exists in S3 and its bytes/hash match what was sent
 *   3. A raw_files row exists in Postgres with status RECEIVED
 *
 * Run with: npm run smoke --workspace=@edi/api
 * Requires `docker compose up -d` (Postgres + MinIO) and a migrated DB.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildServer } from '../src/server.js';
import { getObjectBuffer, ensureBucket } from '../src/storage/s3.js';
import { getPrisma, disconnectPrisma } from '@edi/db';
import type { IngestUploadResponse } from '@edi/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildMultipart(
  fileBuffer: Buffer,
  filename: string,
): { body: Buffer; contentType: string } {
  const boundary = '----ediSmokeBoundary' + Date.now();
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/edi-x12\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, fileBuffer, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main(): Promise<void> {
  const filePath = join(__dirname, 'fixtures', 'sample_850.edi');
  const fileBuffer = readFileSync(filePath);
  const expectedHash = createHash('sha256').update(fileBuffer).digest('hex');

  const app = await buildServer();
  await ensureBucket(app.s3, app.config.s3.bucket);

  const { body, contentType } = buildMultipart(fileBuffer, 'sample_850.edi');

  const res = await app.inject({
    method: 'POST',
    url: '/ingest/upload',
    payload: body,
    headers: { 'content-type': contentType },
  });

  console.log(`[1] POST /ingest/upload -> ${res.statusCode}`);
  assert(res.statusCode === 200, `expected 200, got ${res.statusCode}: ${res.body}`);

  const json = res.json<IngestUploadResponse>();
  assert(json.id, 'response missing id');
  assert(json.status === 'RECEIVED', `expected status RECEIVED, got ${json.status}`);
  assert(json.fileHash === expectedHash, 'returned hash does not match file');
  console.log(`    id=${json.id}`);
  console.log(`    s3Key=${json.s3Key}`);
  console.log(`    fileHash=${json.fileHash}`);

  // [2] Object is in S3 and matches byte-for-byte.
  const stored = await getObjectBuffer(app.s3, app.config.s3.bucket, json.s3Key);
  assert(stored.equals(fileBuffer), 'S3 object bytes do not match uploaded file');
  const storedHash = createHash('sha256').update(stored).digest('hex');
  assert(storedHash === expectedHash, 'S3 object hash mismatch');
  console.log(`[2] S3 object verified (${stored.length} bytes, hash matches)`);

  // [3] Record is in Postgres.
  const record = await getPrisma().rawFile.findUnique({ where: { id: json.id } });
  assert(record, 'no raw_files row found');
  assert(record.s3Key === json.s3Key, 's3Key mismatch in DB');
  assert(record.status === 'RECEIVED', `DB status expected RECEIVED, got ${record.status}`);
  assert(record.source === 'upload', `DB source expected upload, got ${record.source}`);
  console.log(`[3] Postgres row verified (status=${record.status}, source=${record.source})`);

  await app.close();
  await disconnectPrisma();
  console.log('\n✅ SMOKE TEST PASSED — Sprint 1 acceptance criteria met.');
}

main().catch(async (err) => {
  console.error('\n❌ SMOKE TEST FAILED:', err);
  await disconnectPrisma();
  process.exit(1);
});
