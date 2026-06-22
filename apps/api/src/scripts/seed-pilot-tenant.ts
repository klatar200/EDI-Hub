/**
 * Phase 9 Sprint 1 — one-shot pilot tenant seed.
 *
 * The Phase 9.1 migration creates the pilot tenant row with empty
 * `ourIsaIds`. Run this once after migrate to copy your `OUR_ISA_IDS` env
 * var onto the row, so direction resolution still works the way it did
 * before Phase 9.
 *
 *   npm run seed-pilot-tenant --workspace=@edi/api
 *
 * Idempotent: re-runs replace `ourIsaIds` with the current env value.
 */
import { getPrisma, disconnectPrisma, tenantContext, PILOT_TENANT_ID } from '@edi/db';
import { loadConfig } from '../config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = getPrisma();

  // Tenant CRUD is admin work — bypass the per-row tenant filter (Tenant is
  // exempt anyway, but bypass makes intent obvious in code review).
  await tenantContext.bypass(async () => {
    const existing = await prisma.tenant.findUnique({ where: { id: PILOT_TENANT_ID } });
    if (!existing) {
      console.error(`Pilot tenant ${PILOT_TENANT_ID} not found. Did the Phase 9.1 migration run?`);
      process.exit(2);
    }
    const updated = await prisma.tenant.update({
      where: { id: PILOT_TENANT_ID },
      data: { ourIsaIds: config.ourIsaIds },
    });
    console.log(
      `Pilot tenant updated: ourIsaIds = [${updated.ourIsaIds.join(', ')}] ` +
      `(${updated.ourIsaIds.length} entries from OUR_ISA_IDS env)`,
    );
  });

  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error('Seed failed:', err);
  await disconnectPrisma();
  process.exit(1);
});
