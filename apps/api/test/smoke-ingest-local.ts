/**
 * No-Docker end-to-end ingestion loop — the North Star, proven without cloud.
 *
 * Where `smoke-local.ts` requires Docker Postgres + MinIO, this script runs the
 * SAME real pipeline (ingest → parse → lifecycle stitch → detection) against
 * SQLite + the local filesystem storage adapter, exactly as the desktop SKU
 * does. It ingests the synthetic full lifecycle in
 * `Test Files/lifecycles/PO-10001/` (850 → 855 → 856 → 810 → 997) and asserts
 * that all five related documents stitch into one PO conversation.
 *
 * Run (PowerShell or bash):
 *   $env:DATABASE_PROVIDER="sqlite"; $env:DATABASE_URL="file:./e2e.sqlite";
 *   $env:STORAGE_BACKEND="local"; $env:LOCAL_DATA_DIR="./.e2e-data";
 *   npm run -w @edi/db db:migrate:sqlite   # prisma db push (creates e2e.sqlite)
 *   npx tsx apps/api/test/smoke-ingest-local.ts
 *
 * Tenant note: `prisma db push` does not run the Postgres seed migration, so
 * this script creates the pilot tenant itself (idempotent).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildServer } from '../src/server.js';
import { getPrisma, disconnectPrisma, tenantContext, PILOT_TENANT_ID } from '@edi/db';
import type { IngestUploadResponse } from '@edi/shared';
import { runDetectionForAllTenants } from '../src/jobs/handlers/detection.js';
import { getLifecycle } from '../src/services/lifecycle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PO = 'PO-10001';
const OUR_ISA = 'EDIHUB';
const FIXTURE_DIR = join(__dirname, '..', '..', '..', 'Test Files', 'lifecycles', 'PO-10001');
const FILES = [
  '01_850_purchase_order.edi',
  '02_855_acknowledgment.edi',
  '03_856_ship_notice.edi',
  '04_810_invoice.edi',
  '05_997_functional_ack.edi',
];
const EXPECTED_SETS = ['850', '855', '856', '810', '997'];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function buildMultipart(fileBuffer: Buffer, filename: string): { body: Buffer; contentType: string } {
  const boundary = '----ediIngestE2E' + Date.now();
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

async function main(): Promise<void> {
  const prisma = getPrisma();

  // The pilot tenant row is created by the Postgres seed migration in the
  // normal stack; `prisma db push` (SQLite) skips it, so create it here.
  await tenantContext.bypass(async () => {
    const existing = await prisma.tenant.findUnique({ where: { id: PILOT_TENANT_ID } });
    if (!existing) {
      await prisma.tenant.create({
        data: { id: PILOT_TENANT_ID, displayName: 'Pilot (e2e)', ourIsaIds: [OUR_ISA] },
      });
    } else {
      await prisma.tenant.update({ where: { id: PILOT_TENANT_ID }, data: { ourIsaIds: [OUR_ISA] } });
    }
  });
  console.log('[0] pilot tenant ready');

  const app = await buildServer();
  console.log(`[0] server built (storage backend = ${app.config.storage.backend})`);

  // Ingest the full synthetic lifecycle.
  for (const filename of FILES) {
    const fileBuffer = readFileSync(join(FIXTURE_DIR, filename));
    const { body, contentType } = buildMultipart(fileBuffer, filename);
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest/upload',
      payload: body,
      headers: { 'content-type': contentType },
    });
    assert(res.statusCode === 200, `${filename}: expected 200, got ${res.statusCode}: ${res.body}`);
    const json = res.json<IngestUploadResponse>();
    assert(
      json.status === 'PARSED',
      `${filename}: expected PARSED after inline parse, got ${json.status}`,
    );
    console.log(`[1] ingested ${filename} -> ${json.status} (id=${json.id.slice(0, 8)})`);
  }

  // North Star: one PO stitches all related documents.
  const lc = await tenantContext.run({ tenantId: PILOT_TENANT_ID }, () =>
    getLifecycle(prisma, { po: PO }, { ourIsaIds: [OUR_ISA] }),
  );
  assert(lc, `getLifecycle returned null for ${PO}`);

  const setsPresent = new Set(lc.events.map((e) => e.transactionSetId));
  console.log(
    `[2] lifecycle ${PO}: ${lc.events.length} events — sets [${[...setsPresent].sort().join(', ')}]`,
  );
  for (const set of EXPECTED_SETS) {
    assert(setsPresent.has(set), `lifecycle ${PO} is missing a ${set} event (stitch failure)`);
  }
  console.log('[3] all five documents stitched into one PO conversation');

  // Detection runs against the ingested data.
  const detection = await runDetectionForAllTenants({
    prisma,
    notifier: { prisma, config: app.config.notifier },
    suppressionMinutes: app.config.alertSuppressionMinutes,
    now: () => new Date(),
  });
  assert(detection.size >= 1, 'detection returned no tenant results');
  console.log(`[4] detection pass OK (${detection.size} tenant(s))`);

  await app.close();
  await disconnectPrisma();
  console.log('\nNO-DOCKER INGESTION LOOP PASSED — 850 855 856 810 997 stitched on SQLite + local storage.');
}

main().catch(async (err) => {
  console.error('\nNO-DOCKER INGESTION LOOP FAILED:', err);
  try {
    await disconnectPrisma();
  } catch {
    /* swallow */
  }
  process.exit(1);
});
