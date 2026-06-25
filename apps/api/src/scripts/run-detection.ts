/**
 * Phase 7 Sprint 1 - one-shot detection runner.
 *
 *   npm run detect --workspace=@edi/api
 *
 * Invokes the shared detection handler once and reports counts. Used by cron
 * and Windows Task Scheduler in environments that prefer external scheduling
 * over the in-process DB worker (e.g. the SaaS pod still triggered via
 * EventBridge / cron). Exit code 0 on a clean pass; non-zero on a hard error.
 *
 * Desktop track D2 Sprint 2 - the detection logic itself lives in
 * `apps/api/src/jobs/handlers/detection.ts`. Both this CLI and the in-process
 * job worker call `runDetectionPass`, so there's exactly one source of truth.
 */
import { getPrisma, disconnectPrisma } from '@edi/db';
import { loadConfig } from '../config.js';
import { runDetectionPass } from '../jobs/handlers/detection.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = getPrisma();
  const now = new Date();
  // eslint-disable-next-line no-console
  console.log(
    `Detection pass @ ${now.toISOString()}  (notifier mode: ${config.notifier.mode}, ` +
      `suppression: ${config.alertSuppressionMinutes}m)`,
  );
  const result = await runDetectionPass({
    prisma,
    notifier: { prisma, config: config.notifier },
    suppressionMinutes: config.alertSuppressionMinutes,
    now: () => now,
  });
  // eslint-disable-next-line no-console
  console.log(
    `  MISSING_ACK            emitted=${result.missing.emitted}  notified=${result.missing.notified}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `  REJECTION_RATE_SPIKE   emitted=${result.spike.emitted}  notified=${result.spike.notified}`,
  );
  await disconnectPrisma();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('Detection run failed:', err);
  await disconnectPrisma();
  process.exit(1);
});
