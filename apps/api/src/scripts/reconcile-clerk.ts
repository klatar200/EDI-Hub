/**
 * W4.1 — Reconcile Clerk organizations and memberships into hub Tenant/User rows.
 *
 * Use when webhooks were missed or delivered out of order (membership before org).
 *
 *   npm run reconcile-clerk --workspace=@edi/api
 */
import { createClerkClient } from '@clerk/backend';
import { getPrisma, disconnectPrisma, tenantContext } from '@edi/db';
import { reconcileClerkOrganizations } from '../services/clerk-sync.js';

async function main(): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) {
    console.error('CLERK_SECRET_KEY is required.');
    process.exit(1);
  }

  const clerk = createClerkClient({ secretKey });
  const prisma = getPrisma();

  const stats = await tenantContext.bypass(async () =>
    reconcileClerkOrganizations(prisma, clerk as Parameters<typeof reconcileClerkOrganizations>[1]),
  );

  console.log('Clerk reconcile complete:');
  console.log(`  tenants upserted: ${stats.tenantsUpserted}`);
  console.log(`  users upserted:   ${stats.usersUpserted}`);
  console.log(`  users removed:    ${stats.usersRemoved}`);
  if (stats.skippedMemberships > 0) {
    console.log(`  skipped:          ${stats.skippedMemberships}`);
  }

  await disconnectPrisma();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
