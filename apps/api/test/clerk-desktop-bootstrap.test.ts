/**
 * Desktop hub — attach pilot tenant to sole Clerk org when unbound.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { PILOT_TENANT_ID } from '@edi/db';
import { attachPilotTenantIfSingleOrg } from '../src/services/clerk-desktop-bootstrap.js';

const ORG_ID = 'org_desktop_single';

function makePrisma(world: {
  pilot: { id: string; clerkOrgId: string | null; displayName: string };
  tenants: Array<{ id: string; clerkOrgId: string | null; displayName: string }>;
  rawFiles: Record<string, number>;
  partners: Record<string, number>;
}): PrismaClient {
  return {
    tenant: {
      async findUnique({ where }: { where: { id?: string; clerkOrgId?: string } }) {
        if (where.id) {
          return world.tenants.find((t) => t.id === where.id) ?? null;
        }
        if (where.clerkOrgId) {
          return world.tenants.find((t) => t.clerkOrgId === where.clerkOrgId) ?? null;
        }
        return null;
      },
      async update({ where, data }: { where: { id: string }; data: { clerkOrgId: string; displayName: string } }) {
        const row = world.tenants.find((t) => t.id === where.id)!;
        row.clerkOrgId = data.clerkOrgId;
        row.displayName = data.displayName;
        return row;
      },
      async delete({ where }: { where: { id: string } }) {
        world.tenants = world.tenants.filter((t) => t.id !== where.id);
      },
    },
    user: {
      async deleteMany(_opts: { where: { tenantId: string } }) {
        return { count: 0 };
      },
    },
    rawFile: {
      async count({ where }: { where: { tenantId: string } }) {
        return world.rawFiles[where.tenantId] ?? 0;
      },
    },
    tradingPartner: {
      async count({ where }: { where: { tenantId: string } }) {
        return world.partners[where.tenantId] ?? 0;
      },
    },
  } as unknown as PrismaClient;
}

const clerkSingleOrg = {
  organizations: {
    async getOrganizationList(_opts: { limit: number; offset: number }) {
      return { data: [{ id: ORG_ID, name: 'Desktop Org' }], totalCount: 1 };
    },
    async getOrganizationMembershipList() {
      return { data: [], totalCount: 0 };
    },
  },
} as Parameters<typeof attachPilotTenantIfSingleOrg>[1];

test('attachPilotTenantIfSingleOrg binds pilot when unbound and sole org exists', async () => {
  const world = {
    pilot: { id: PILOT_TENANT_ID, clerkOrgId: null, displayName: 'Pilot' },
    tenants: [{ id: PILOT_TENANT_ID, clerkOrgId: null, displayName: 'Pilot' }],
    rawFiles: {},
    partners: {},
  };
  const attached = await attachPilotTenantIfSingleOrg(makePrisma(world), clerkSingleOrg);
  assert.equal(attached, true);
  assert.equal(world.tenants[0]!.clerkOrgId, ORG_ID);
});

test('attachPilotTenantIfSingleOrg is a no-op when pilot already bound', async () => {
  const world = {
    pilot: { id: PILOT_TENANT_ID, clerkOrgId: ORG_ID, displayName: 'Pilot' },
    tenants: [{ id: PILOT_TENANT_ID, clerkOrgId: ORG_ID, displayName: 'Pilot' }],
    rawFiles: {},
    partners: {},
  };
  const attached = await attachPilotTenantIfSingleOrg(makePrisma(world), clerkSingleOrg);
  assert.equal(attached, false);
});
