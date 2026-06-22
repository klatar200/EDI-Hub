/**
 * Phase 7 Sprint 1 — one-shot detection runner.
 *
 *   npm run detect --workspace=@edi/api
 *
 * Invokes both detectors against the live DB once and reports counts. Suitable
 * for cron / Task Scheduler invocation until Sprint 2 wires the BullMQ
 * scheduler. Exit code 0 always — we want the scheduler to keep running even
 * if a run emitted nothing.
 */
import { getPrisma, disconnectPrisma, tenantContext, PILOT_TENANT_ID } from '@edi/db';
import { detectMissingAcks, detectRejectionSpikes } from '../services/detection.js';
import { loadConfig } from '../config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = getPrisma();
  const now = new Date();
  const notifier = { prisma, config: config.notifier };
  const opts = { notifier, suppressionMinutes: config.alertSuppressionMinutes };
  console.log(`Detection pass @ ${now.toISOString()}  (notifier mode: ${config.notifier.mode}, suppression: ${config.alertSuppressionMinutes}m)`);
  // Phase 9 Sprint 1.4 — pin detection to the pilot tenant. Future per-tenant
  // detection will iterate the Tenant table and run each pass under its own
  // context (so partner SLAs and rejection baselines are tenant-scoped).
  await tenantContext.run({ tenantId: PILOT_TENANT_ID }, async () => {
    const missing = await detectMissingAcks(prisma, now, opts);
    console.log(`  MISSING_ACK            emitted=${missing.emitted}  notified=${missing.notified}`);
    const spike = await detectRejectionSpikes(prisma, now, opts);
    console.log(`  REJECTION_RATE_SPIKE   emitted=${spike.emitted}  notified=${spike.notified}`);
  });
  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error('Detection run failed:', err);
  await disconnectPrisma();
  process.exit(1);
});
