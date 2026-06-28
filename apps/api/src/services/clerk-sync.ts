/**
 * W4.1 — Shared Clerk → hub DB sync helpers (webhooks + reconcile script).
 */
import type { PrismaClient } from '@prisma/client';

export function mapClerkRole(role: string): 'admin' | 'ops' | 'viewer' {
  if (role === 'org:admin' || role === 'admin') return 'admin';
  return 'viewer';
}

export function displayNameFromClerkUser(publicUser: {
  first_name?: string | null;
  last_name?: string | null;
}): string | null {
  const first = publicUser.first_name?.trim();
  const last = publicUser.last_name?.trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  return null;
}

export interface ReconcileStats {
  tenantsUpserted: number;
  usersUpserted: number;
  usersRemoved: number;
  skippedMemberships: number;
}

/** Pull all Clerk orgs + memberships into Tenant/User rows. Idempotent. */
export async function reconcileClerkOrganizations(
  prisma: PrismaClient,
  clerk: {
    organizations: {
      getOrganizationList: (opts: { limit: number; offset: number }) => Promise<{
        data: Array<{ id: string; name: string }>;
        totalCount: number;
      }>;
      getOrganizationMembershipList: (opts: {
        organizationId: string;
        limit: number;
        offset: number;
      }) => Promise<{
        data: Array<{
          role: string;
          publicUserData?: {
            userId?: string;
            identifier?: string | null;
            firstName?: string | null;
            lastName?: string | null;
          } | null;
        }>;
        totalCount: number;
      }>;
    };
  },
): Promise<ReconcileStats> {
  const stats: ReconcileStats = {
    tenantsUpserted: 0,
    usersUpserted: 0,
    usersRemoved: 0,
    skippedMemberships: 0,
  };

  const pageSize = 100;
  let offset = 0;
  let total = 0;

  do {
    const page = await clerk.organizations.getOrganizationList({ limit: pageSize, offset });
    total = page.totalCount;
    offset += page.data.length;

    for (const org of page.data) {
      await prisma.tenant.upsert({
        where: { clerkOrgId: org.id },
        create: { displayName: org.name, clerkOrgId: org.id },
        update: { displayName: org.name },
      });
      stats.tenantsUpserted += 1;

      const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: org.id } });
      if (!tenant) {
        stats.skippedMemberships += 1;
        continue;
      }

      const seenUserIds = new Set<string>();
      let memberOffset = 0;
      let memberTotal = 0;

      do {
        const members = await clerk.organizations.getOrganizationMembershipList({
          organizationId: org.id,
          limit: pageSize,
          offset: memberOffset,
        });
        memberTotal = members.totalCount;
        memberOffset += members.data.length;

        for (const m of members.data) {
          const pub = m.publicUserData;
          const clerkUserId = pub?.userId;
          if (!clerkUserId) {
            stats.skippedMemberships += 1;
            continue;
          }
          seenUserIds.add(clerkUserId);
          const email = pub.identifier ?? '';
          const displayName = displayNameFromClerkUser({
            first_name: pub.firstName,
            last_name: pub.lastName,
          });
          const role = mapClerkRole(m.role);
          await prisma.user.upsert({
            where: { tenantId_clerkUserId: { tenantId: tenant.id, clerkUserId } },
            create: {
              tenantId: tenant.id,
              clerkUserId,
              email,
              displayName,
              role,
            },
            update: { email, displayName, role },
          });
          stats.usersUpserted += 1;
        }
      } while (memberOffset < memberTotal);

      const existing = await prisma.user.findMany({
        where: { tenantId: tenant.id },
        select: { id: true, clerkUserId: true },
      });
      for (const row of existing) {
        if (!seenUserIds.has(row.clerkUserId)) {
          await prisma.user.delete({ where: { id: row.id } });
          stats.usersRemoved += 1;
        }
      }
    }
  } while (offset < total);

  return stats;
}
