/**
 * Phase 9 Sprint 2 — Bypass the Clerk membership webhook and create the
 * admin User row on the pilot tenant directly.
 *
 *   npm run seed-pilot-admin --workspace=@edi/api -- \
 *     user_xxxxxxxxxx me@example.com [admin|ops|viewer]
 *
 * Use this when:
 *   - Clerk's `organizationMembership.created` event didn't fire (webhook
 *     subscription gap), OR
 *   - You re-attached the pilot tenant via attach-pilot-org and the User
 *     row from the auto-provisioned tenant got swept along with it.
 *
 * Idempotent on (tenantId, clerkUserId): re-running upserts.
 */
import { getPrisma, disconnectPrisma, tenantContext, PILOT_TENANT_ID } from '@edi/db';

async function main(): Promise<void> {
  const [clerkUserId, email, roleArg] = process.argv.slice(2);
  const role = (roleArg ?? 'admin') as 'admin' | 'ops' | 'viewer';
  if (!clerkUserId || !clerkUserId.startsWith('user_') || !email || !email.includes('@')) {
    console.error('Usage: npm run seed-pilot-admin -- <clerk_user_id> <email> [admin|ops|viewer]');
    console.error('       e.g. npm run seed-pilot-admin -- user_abc123 me@example.com admin');
    process.exit(2);
  }
  if (!['admin', 'ops', 'viewer'].includes(role)) {
    console.error(`Role must be admin / ops / viewer, got "${role}".`);
    process.exit(2);
  }

  const prisma = getPrisma();

  await tenantContext.bypass(async () => {
    const tenant = await prisma.tenant.findUnique({ where: { id: PILOT_TENANT_ID } });
    if (!tenant) {
      console.error(`Pilot tenant ${PILOT_TENANT_ID} not found. Did the Phase 9.1 migration run?`);
      process.exit(2);
    }
    if (!tenant.clerkOrgId) {
      console.error(
        `Pilot tenant has no clerkOrgId. Run attach-pilot-org first so the User row maps to the right org.`,
      );
      process.exit(2);
    }

    const row = await prisma.user.upsert({
      where: { tenantId_clerkUserId: { tenantId: PILOT_TENANT_ID, clerkUserId } },
      update: { email, role },
      create: { tenantId: PILOT_TENANT_ID, clerkUserId, email, role },
    });
    console.log(`User row ready:`);
    console.log(`  id          ${row.id}`);
    console.log(`  tenantId    ${row.tenantId}  (pilot)`);
    console.log(`  clerkUserId ${row.clerkUserId}`);
    console.log(`  email       ${row.email}`);
    console.log(`  role        ${row.role}`);
  });

  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error('Seed failed:', err);
  await disconnectPrisma();
  process.exit(1);
});
