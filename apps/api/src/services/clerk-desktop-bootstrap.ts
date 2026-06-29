/**
 * Desktop hub — sync Clerk orgs/users without webhooks.
 *
 * Packaged installs cannot receive Clerk webhooks on localhost, so every API
 * boot reconciles Clerk into Tenant/User rows. When the seeded pilot tenant
 * still has no clerkOrgId (pre-Phase-9 data), bind it to the sole Clerk org
 * so historical rows stay under PILOT_TENANT_ID.
 */
import type { PrismaClient } from '@prisma/client';
import { PILOT_TENANT_ID, tenantContext } from '@edi/db';
import { reconcileClerkOrganizations, type ReconcileStats } from './clerk-sync.js';

type ClerkOrgClient = Parameters<typeof reconcileClerkOrganizations>[1];

export interface DesktopClerkBootstrapResult {
  pilotAttached: boolean;
  reconcile: ReconcileStats;
}

/** Attach the pilot tenant to the only Clerk org when it is still unbound. */
export async function attachPilotTenantIfSingleOrg(
  prisma: PrismaClient,
  clerk: ClerkOrgClient,
): Promise<boolean> {
  const pilot = await prisma.tenant.findUnique({ where: { id: PILOT_TENANT_ID } });
  if (!pilot || pilot.clerkOrgId) return false;

  const page = await clerk.organizations.getOrganizationList({ limit: 10, offset: 0 });
  if (page.data.length !== 1) return false;

  const org = page.data[0]!;
  const conflict = await prisma.tenant.findUnique({ where: { clerkOrgId: org.id } });
  if (conflict && conflict.id !== PILOT_TENANT_ID) {
    const [rawFiles, partners] = await Promise.all([
      prisma.rawFile.count({ where: { tenantId: conflict.id } }),
      prisma.tradingPartner.count({ where: { tenantId: conflict.id } }),
    ]);
    if (rawFiles > 0 || partners > 0) return false;

    await prisma.user.deleteMany({ where: { tenantId: conflict.id } });
    await prisma.tenant.delete({ where: { id: conflict.id } });
  }

  await prisma.tenant.update({
    where: { id: PILOT_TENANT_ID },
    data: { clerkOrgId: org.id, displayName: org.name },
  });
  return true;
}

/** Desktop startup: bind pilot (when safe) then reconcile all Clerk memberships. */
export async function bootstrapDesktopClerk(
  prisma: PrismaClient,
  clerk: ClerkOrgClient,
): Promise<DesktopClerkBootstrapResult> {
  return tenantContext.bypass(async () => {
    const pilotAttached = await attachPilotTenantIfSingleOrg(prisma, clerk);
    const reconcile = await reconcileClerkOrganizations(prisma, clerk);
    return { pilotAttached, reconcile };
  });
}
