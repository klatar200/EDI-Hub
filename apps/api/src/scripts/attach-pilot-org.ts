/**
 * Phase 9 Sprint 2 — Attach an existing Clerk Organization to the seeded
 * pilot tenant so historical data stays put under the new auth model.
 *
 *   npm run attach-pilot-org --workspace=@edi/api -- <clerk_org_id>
 *
 * Use `--force` to first detach + delete any other tenant currently bound
 * to that org id (common when the webhook auto-created a fresh tenant
 * before you ran this script):
 *
 *   npm run attach-pilot-org --workspace=@edi/api -- <clerk_org_id> --force
 *
 * `--force` deletes the conflicting tenant AND its Users (the webhook
 * created at most one User row at sign-up). Business data on the
 * conflicting tenant — if any — also disappears, so only force when the
 * conflicting tenant is the empty one Clerk auto-provisioned. The
 * confirmation banner lists what would be deleted before doing it.
 *
 * Idempotent: re-running with the same org id is a no-op. Re-running with
 * a DIFFERENT org id rebinds the pilot tenant to that org.
 */
import { getPrisma, disconnectPrisma, tenantContext, PILOT_TENANT_ID } from '@edi/db';

async function main(): Promise<void> {
  const orgId = process.argv[2];
  const force = process.argv.includes('--force');
  if (!orgId || !orgId.startsWith('org_')) {
    console.error('Usage: npm run attach-pilot-org -- <clerk_org_id> [--force]');
    console.error('       (the id starts with "org_" — find it in the Clerk dashboard)');
    process.exit(2);
  }

  const prisma = getPrisma();

  await tenantContext.bypass(async () => {
    const existing = await prisma.tenant.findUnique({ where: { id: PILOT_TENANT_ID } });
    if (!existing) {
      console.error(`Pilot tenant ${PILOT_TENANT_ID} not found. Did the Phase 9.1 migration run?`);
      process.exit(2);
    }

    // If another tenant already claims this clerkOrgId, we'd violate the
    // unique constraint. Bail unless --force is set.
    const conflict = await prisma.tenant.findUnique({ where: { clerkOrgId: orgId } });
    if (conflict && conflict.id !== PILOT_TENANT_ID) {
      if (!force) {
        console.error(
          `Refusing to attach: clerkOrgId ${orgId} is already attached to tenant ${conflict.id} ` +
          `("${conflict.displayName}"). Re-run with --force to delete that tenant first.`,
        );
        process.exit(3);
      }
      // Count what we're about to wipe — surface in the banner so the operator
      // can abort if any of these counts surprise them.
      const [partners, rawFiles, alerts, users, audit] = await Promise.all([
        prisma.tradingPartner.count({ where: { tenantId: conflict.id } }),
        prisma.rawFile.count({ where: { tenantId: conflict.id } }),
        prisma.alert.count({ where: { tenantId: conflict.id } }),
        prisma.user.count({ where: { tenantId: conflict.id } }),
        prisma.auditEvent.count({ where: { tenantId: conflict.id } }),
      ]);
      console.warn(
        `--force: detaching + deleting conflicting tenant ${conflict.id} ("${conflict.displayName}").`,
      );
      console.warn(
        `         losing: partners=${partners} rawFiles=${rawFiles} alerts=${alerts} users=${users} audit=${audit}`,
      );
      // Delete in dependency order (User → Audit → Tenant). Interchanges
      // and below cascade via the schema; partners + alerts + raw files
      // explicitly cleared so the FK to Tenant releases.
      await prisma.user.deleteMany({ where: { tenantId: conflict.id } });
      await prisma.auditEvent.deleteMany({ where: { tenantId: conflict.id } });
      await prisma.interchange.deleteMany({ where: { tenantId: conflict.id } });
      await prisma.rawFile.deleteMany({ where: { tenantId: conflict.id } });
      await prisma.alert.deleteMany({ where: { tenantId: conflict.id } });
      await prisma.tradingPartner.deleteMany({ where: { tenantId: conflict.id } });
      await prisma.tenant.delete({ where: { id: conflict.id } });
    }

    const updated = await prisma.tenant.update({
      where: { id: PILOT_TENANT_ID },
      data: { clerkOrgId: orgId },
    });
    console.log(
      `Pilot tenant ${PILOT_TENANT_ID} is now attached to Clerk org ${updated.clerkOrgId}.`,
    );
    console.log(
      `Next: in the Clerk dashboard → Webhooks → recent deliveries, find the most`,
    );
    console.log(
      `      recent 'organizationMembership.created' event for your org and click Resend.`,
    );
    console.log(
      `      That re-fires the User-row creation against the now-attached pilot tenant.`,
    );
  });

  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error('Attach failed:', err);
  await disconnectPrisma();
  process.exit(1);
});
