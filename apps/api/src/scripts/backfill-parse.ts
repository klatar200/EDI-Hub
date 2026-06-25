/**
 * Backfill: (re)parse already-ingested raw files that haven't been decomposed.
 *
 * Useful after deploying Phase 2 to parse files ingested under Phase 1, or to
 * re-run parsing after a parser change. Reads bytes from S3 (no in-memory
 * shortcut), so it works for any stored file.
 *
 *   npm run backfill --workspace=@edi/api
 *
 * After a parser change that adds fields to existing sets (e.g. Phase 4 adding
 * shipmentId / ack-linkage / direction), pass `--reparse-parsed` to also re-run
 * parsing for files already in PARSED state so historical rows pick up the new
 * columns.
 */
import type { FastifyBaseLogger } from 'fastify';
import { getPrisma, disconnectPrisma, tenantContext, PILOT_TENANT_ID } from '@edi/db';
import { loadConfig } from '../config.js';
import { createS3Client } from '../storage/s3.js';
import { createStorageAdapter } from '../storage/factory.js';
import { parseAndStore } from '../services/parsing.js';

const logger = {
  info() {}, warn() {}, error() {}, debug() {}, fatal() {}, trace() {}, silent() {},
  child() { return logger; },
} as unknown as FastifyBaseLogger;

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = getPrisma();
  const s3 = createS3Client(config.s3);
  const storage = createStorageAdapter(config, s3);

  // Phase 9 Sprint 1.4 — scripts have no request context; pin the whole
  // backfill to the pilot tenant. Future per-tenant backfills will accept a
  // --tenant-id arg and iterate per-tenant.
  await tenantContext.run({ tenantId: PILOT_TENANT_ID }, async () => {
    const reparseParsed = process.argv.includes('--reparse-parsed');
    const statuses = reparseParsed ? (['RECEIVED', 'PARSED', 'PARSE_ERROR'] as const) : (['RECEIVED'] as const);

    // Files that were ingested as valid X12 but not yet decomposed (or, with the
    // flag, anything that's parseable so the new lifecycle columns get populated).
    const targets = await prisma.rawFile.findMany({ where: { status: { in: [...statuses] } } });
    console.log(`Backfill: ${targets.length} raw file(s) to parse (statuses: ${statuses.join(', ')}).`);

    let parsed = 0;
    let errored = 0;
    for (const raw of targets) {
      const result = await parseAndStore({ s3, storage, prisma, config, logger }, { rawFileId: raw.id });
      if (result.outcome === 'parsed') {
        parsed += 1;
        console.log(`  ${raw.id} -> parsed (${result.transactions} txn, ${result.segments} seg, ${result.warnings.length} warn)`);
      } else {
        errored += 1;
        console.log(`  ${raw.id} -> ${result.outcome}`);
      }
    }

    console.log(`Backfill complete: ${parsed} parsed, ${errored} skipped/errored.`);
  });

  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error('Backfill failed:', err);
  await disconnectPrisma();
  process.exit(1);
});
