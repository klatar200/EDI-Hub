/**
 * Backfill: set `confirmedAt` on every outbound original that has already been
 * acknowledged by a stored 997/999.
 *
 * Run once after deploying Phase 8 Sprint 1 to fill in the new column for
 * historical chains. Idempotent — the propagator only touches rows where
 * `confirmedAt IS NULL`, so re-runs are no-ops.
 *
 *   npm run backfill-confirmed-at --workspace=@edi/api
 */
import { getPrisma, disconnectPrisma, tenantContext, PILOT_TENANT_ID } from '@edi/db';
import { backfillConfirmedAt } from '../services/parsing.js';

async function main(): Promise<void> {
  const prisma = getPrisma();
  // Phase 9 Sprint 1.4 — scripts pin to the pilot tenant.
  const updated = await tenantContext.run(
    { tenantId: PILOT_TENANT_ID },
    () => backfillConfirmedAt(prisma),
  );
  console.log(`Backfill complete: ${updated} outbound transaction(s) marked confirmed.`);
  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error('Backfill failed:', err);
  await disconnectPrisma();
  process.exit(1);
});
