/**
 * Local stack smoke — requires Docker Postgres + MinIO and migrated DB.
 *
 * Validates BUILD_PLAN §3.1 exit criteria:
 *   - ingest upload → S3 + Postgres
 *   - inline parse → PARSED + lifecycle row
 *   - detection pass runs without error
 *   - /health responds
 *
 * Run: npm run smoke:local --workspace=@edi/api
 * Or:  npm run validate:local   (from repo root — checks ports, migrate, then this)
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildServer } from '../src/server.js';
import { getObjectBuffer, ensureBucket } from '../src/storage/s3.js';
import { getPrisma, disconnectPrisma, tenantContext, PILOT_TENANT_ID } from '@edi/db';
import type { IngestUploadResponse } from '@edi/shared';
import { runDetectionForAllTenants } from '../src/jobs/handlers/detection.js';
import { listLifecycles } from '../src/services/lifecycles.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildMultipart(
  fileBuffer: Buffer,
  filename: string,
): { body: Buffer; contentType: string } {
  const boundary = '----ediSmokeLocal' + Date.now();
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

/** Unique ISA control + PO so repeated runs do not dedupe. */
function uniqueSample850(): { content: Buffer; po: string; isaControl: string } {
  const base = readFileSync(join(__dirname, 'fixtures', 'sample_850.edi'), 'utf8');
  const suffix = String(Date.now()).slice(-6);
  const isaControl = suffix.padStart(9, '0');
  const po = `PO-SMOKE-${suffix}`;
  let content = base.replace(/000000001/g, isaControl);
  content = content.replace(/PO-12345/g, po);
  return { content: Buffer.from(content, 'utf8'), po, isaControl };
}

async function main(): Promise<void> {
  const { content: fileBuffer, po } = uniqueSample850();
  const expectedHash = createHash('sha256').update(fileBuffer).digest('hex');

  const prisma = getPrisma();
  await prisma.$queryRaw`SELECT 1`;
  console.log('[0] Postgres connection OK');

  const app = await buildServer();
  await ensureBucket(app.s3, app.config.s3.bucket);
  console.log('[0] MinIO bucket OK');

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert(health.statusCode === 200, `health expected 200, got ${health.statusCode}`);
  console.log('[1] GET /health -> 200');

  const { body, contentType } = buildMultipart(fileBuffer, 'sample_850.edi');
  const res = await app.inject({
    method: 'POST',
    url: '/api/ingest/upload',
    payload: body,
    headers: { 'content-type': contentType },
  });

  console.log(`[2] POST /ingest/upload -> ${res.statusCode}`);
  assert(res.statusCode === 200, `expected 200, got ${res.statusCode}: ${res.body}`);

  const json = res.json<IngestUploadResponse>();
  assert(json.id, 'response missing id');
  assert(json.status === 'PARSED', `expected PARSED after inline parse, got ${json.status}`);
  assert(json.fileHash === expectedHash, 'returned hash does not match file');
  console.log(`    id=${json.id} status=${json.status} po=${po}`);

  const stored = await getObjectBuffer(app.s3, app.config.s3.bucket, json.s3Key);
  assert(stored.equals(fileBuffer), 'S3 object bytes do not match uploaded file');
  console.log(`[3] S3 object verified (${stored.length} bytes)`);

  const record = await getPrisma().rawFile.findUnique({ where: { id: json.id } });
  assert(record?.status === 'PARSED', `DB status expected PARSED, got ${record?.status}`);
  console.log('[4] Postgres raw_files row PARSED');

  const lifecycles = await tenantContext.run({ tenantId: PILOT_TENANT_ID }, () =>
    listLifecycles(prisma, { pos: [po] }, { ourIsaIds: [] }),
  );
  assert(lifecycles.items.some((r: { po: string }) => r.po === po), `lifecycle list missing PO ${po}`);
  console.log(`[5] GET /lifecycles (service) includes ${po}`);

  const detection = await runDetectionForAllTenants({
    prisma,
    notifier: { prisma, config: app.config.notifier },
    suppressionMinutes: app.config.alertSuppressionMinutes,
    now: () => new Date(),
  });
  assert(detection.size >= 1, 'detection returned no tenant results');
  console.log(`[6] Detection pass OK (${detection.size} tenant(s))`);

  await app.close();
  await disconnectPrisma();
  console.log('\n✅ LOCAL STACK SMOKE PASSED — Docker Postgres + MinIO validated.');
}

main().catch(async (err) => {
  console.error('\n❌ LOCAL STACK SMOKE FAILED:', err);
  await disconnectPrisma();
  process.exit(1);
});
