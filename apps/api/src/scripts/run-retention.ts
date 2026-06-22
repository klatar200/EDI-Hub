/**
 * Phase 10 Sprint 3 — Retention worker entrypoint.
 *
 * Run via `npm run retention --workspace=apps/api` (or directly via tsx
 * for dev iteration). In production this runs as a scheduled ECS task
 * on the same cadence as the backup task (daily, off-peak).
 *
 * Exits non-zero if anything throws; the CloudWatch alarm on the parent
 * ECS scheduled-task failure metric is the operational signal.
 */
import { disconnectPrisma, getPrisma } from '@edi/db';
import { loadConfig } from '../config.js';
import { createS3Client } from '../storage/s3.js';
import { runRetention, sweepDeletedTenants } from '../services/retention.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = getPrisma();
  const s3 = createS3Client(config.s3);
  const now = new Date();

  // 1. TTL sweep across every active tenant.
  const counts = await runRetention({ prisma, s3, s3Bucket: config.s3.bucket }, now);
  for (const [tenantId, c] of counts.entries()) {
    console.log(`[retention] tenant=${tenantId}`, c);
  }

  // 2. Hard-delete tenants past the 30-day soft-delete grace.
  const deleted = await sweepDeletedTenants(prisma, now, 30);
  for (const [tenantId, c] of deleted.entries()) {
    console.log(`[retention] hard-deleted tenant=${tenantId}`, c);
  }

  await disconnectPrisma();
}

main().catch((err) => {
  console.error('[retention] fatal:', err);
  process.exit(1);
});
