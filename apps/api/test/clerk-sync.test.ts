/**
 * SEC-C1 — Clerk reconcile script unit tests (in-memory Clerk + Prisma fakes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { reconcileClerkOrganizations } from '../src/services/clerk-sync.js';

interface FakeTenant {
  id: string;
  clerkOrgId: string;
  displayName: string;
}

interface FakeUser {
  id: string;
  tenantId: string;
  clerkUserId: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'ops' | 'viewer';
}

function makePrisma(world: { tenants: FakeTenant[]; users: FakeUser[]; seq: number }): PrismaClient {
  return {
    tenant: {
      async upsert({ where, create, update }: {
        where: { clerkOrgId: string };
        create: { displayName: string; clerkOrgId: string };
        update: { displayName: string };
      }) {
        const existing = world.tenants.find((t) => t.clerkOrgId === where.clerkOrgId);
        if (existing) {
          existing.displayName = update.displayName;
          return existing;
        }
        const row: FakeTenant = {
          id: `t-${(world.seq += 1)}`,
          clerkOrgId: create.clerkOrgId,
          displayName: create.displayName,
        };
        world.tenants.push(row);
        return row;
      },
      async findUnique({ where }: { where: { clerkOrgId: string } }) {
        return world.tenants.find((t) => t.clerkOrgId === where.clerkOrgId) ?? null;
      },
    },
    user: {
      async upsert({ where, create, update }: {
        where: { tenantId_clerkUserId: { tenantId: string; clerkUserId: string } };
        create: Omit<FakeUser, 'id'>;
        update: Partial<Pick<FakeUser, 'email' | 'displayName' | 'role'>>;
      }) {
        const existing = world.users.find(
          (u) => u.tenantId === where.tenantId_clerkUserId.tenantId
            && u.clerkUserId === where.tenantId_clerkUserId.clerkUserId,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row: FakeUser = { id: `u-${(world.seq += 1)}`, ...create };
        world.users.push(row);
        return row;
      },
      async findMany({ where }: { where: { tenantId: string } }) {
        return world.users.filter((u) => u.tenantId === where.tenantId);
      },
      async delete({ where }: { where: { id: string } }) {
        const idx = world.users.findIndex((u) => u.id === where.id);
        if (idx >= 0) world.users.splice(idx, 1);
      },
    },
  } as unknown as PrismaClient;
}

test('reconcileClerkOrganizations upserts tenants and users from Clerk', async () => {
  const world = { tenants: [] as FakeTenant[], users: [] as FakeUser[], seq: 0 };
  const prisma = makePrisma(world);
  const clerk = {
    organizations: {
      async getOrganizationList() {
        return {
          data: [{ id: 'org_1', name: 'Acme' }],
          totalCount: 1,
        };
      },
      async getOrganizationMembershipList() {
        return {
          data: [{
            role: 'org:admin',
            publicUserData: {
              userId: 'user_1',
              identifier: 'ops@acme.com',
              firstName: 'Ops',
              lastName: 'User',
            },
          }],
          totalCount: 1,
        };
      },
    },
  };

  const stats = await reconcileClerkOrganizations(prisma, clerk);
  assert.equal(stats.tenantsUpserted, 1);
  assert.equal(stats.usersUpserted, 1);
  assert.equal(world.tenants[0]!.displayName, 'Acme');
  assert.equal(world.users[0]!.email, 'ops@acme.com');
  assert.equal(world.users[0]!.role, 'admin');
});
