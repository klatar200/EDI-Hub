/**
 * FIX_PLAN W2.1 — detection runs for every active tenant, not just the pilot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { tenantContext, PILOT_TENANT_ID } from '@edi/db';
import { runDetectionForAllTenants } from '../src/jobs/handlers/detection.js';

const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

type Dir = 'inbound' | 'outbound' | 'unknown';

interface FakeTxn {
  id: string;
  tenantId: string;
  transactionSetId: string;
  controlNumber: string;
  direction: Dir;
  poNumber: string | null;
  ackedGroupControl: string | null;
  functionalGroup: {
    controlNumber: string;
    interchange: {
      senderId: string;
      receiverId: string;
      rawFile: { ingestedAt: Date };
    };
  };
}

interface FakePartner {
  id: string;
  tenantId: string;
  displayName: string;
  isaSenderIds: string[];
  isaReceiverIds: string[];
  slaWindows: Array<{ setId: string; direction: Dir; withinMinutes: number }>;
  status: 'active' | 'disabled';
}

interface FakeAlert {
  id: string;
  tenantId: string;
  partnerId: string | null;
  type: string;
  dedupeKey: string;
  severity: string;
  title: string;
  body: string;
  sourceRef: unknown;
  status: string;
  createdAt: Date;
  lastSeenAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  suppressUntil: Date | null;
}

interface FakeStore {
  tenants: Array<{ id: string; deletedAt: Date | null }>;
  partners: FakePartner[];
  txns: FakeTxn[];
  alerts: FakeAlert[];
  seq: number;
}

function scopedTenantId(): string | undefined {
  const ctx = tenantContext.current();
  if (!ctx || ctx.bypass) return undefined;
  return ctx.tenantId;
}

function txnMatches(t: FakeTxn, where: Record<string, unknown>): boolean {
  if (where.transactionSetId !== undefined) {
    const v = where.transactionSetId as string | { in?: string[] };
    if (typeof v === 'string' && t.transactionSetId !== v) return false;
    if (typeof v === 'object' && Array.isArray(v.in) && !v.in.includes(t.transactionSetId)) return false;
  }
  if (where.direction !== undefined && t.direction !== where.direction) return false;
  if (where.ackedGroupControl !== undefined) {
    const v = where.ackedGroupControl as string | { in?: string[] };
    if (typeof v === 'string' && t.ackedGroupControl !== v) return false;
    if (typeof v === 'object' && Array.isArray(v.in) && (!t.ackedGroupControl || !v.in.includes(t.ackedGroupControl))) {
      return false;
    }
  }
  const fg = where.functionalGroup as { interchange?: Record<string, unknown> } | undefined;
  if (fg?.interchange) {
    const ic = fg.interchange;
    const rf = ic.rawFile as { ingestedAt?: { gte?: Date; lte?: Date } } | undefined;
    if (rf?.ingestedAt) {
      const at = t.functionalGroup.interchange.rawFile.ingestedAt.getTime();
      if (rf.ingestedAt.gte && at < rf.ingestedAt.gte.getTime()) return false;
      if (rf.ingestedAt.lte && at > rf.ingestedAt.lte.getTime()) return false;
    }
    const ors = ic.OR as Array<Record<string, unknown>> | undefined;
    if (ors && ors.length > 0) {
      const any = ors.some((or) => {
        const s = (or.senderId as { in?: string[] } | undefined)?.in ?? [];
        const r = (or.receiverId as { in?: string[] } | undefined)?.in ?? [];
        return (
          s.includes(t.functionalGroup.interchange.senderId) ||
          r.includes(t.functionalGroup.interchange.receiverId)
        );
      });
      if (!any) return false;
    }
  }
  return true;
}

function makePrisma(store: FakeStore): PrismaClient {
  return {
    tenant: {
      async findMany({ where = {} }: { where?: Record<string, unknown> } = {}) {
        let rows = [...store.tenants];
        if (where.deletedAt === null) rows = rows.filter((r) => r.deletedAt === null);
        return rows;
      },
      async findUnique() {
        return {
          settings: {
            staleTrafficWindowHours: 6,
            slaCountdownEnabled: false,
            quietHoursStart: null,
            quietHoursEnd: null,
            emailDigestEnabled: false,
            emailDigestHourUtc: 8,
          },
        };
      },
    },
    tradingPartner: {
      async findMany({ where }: { where?: { status?: 'active' | 'disabled' } } = {}) {
        const tenantId = scopedTenantId();
        return store.partners.filter(
          (p) => (!tenantId || p.tenantId === tenantId) && (!where?.status || p.status === where.status),
        );
      },
    },
    transaction: {
      async findMany({ where }: { where: Record<string, unknown> }) {
        const tenantId = scopedTenantId();
        return store.txns.filter(
          (t) => (!tenantId || t.tenantId === tenantId) && txnMatches(t, where),
        );
      },
    },
    alert: {
      async findUnique({ where }: { where: { dedupeKey?: string } }) {
        const tenantId = scopedTenantId();
        return (
          store.alerts.find(
            (a) => a.dedupeKey === where.dedupeKey && (!tenantId || a.tenantId === tenantId),
          ) ?? null
        );
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const tenantId = scopedTenantId() ?? (data.tenantId as string);
        const row: FakeAlert = {
          id: `a-${(store.seq += 1)}`,
          tenantId,
          partnerId: (data.partnerId as string | null | undefined) ?? null,
          type: data.type as string,
          severity: (data.severity as string | undefined) ?? 'warning',
          title: data.title as string,
          body: data.body as string,
          dedupeKey: data.dedupeKey as string,
          sourceRef: data.sourceRef ?? {},
          status: 'active',
          createdAt: (data.createdAt as Date | undefined) ?? new Date(),
          lastSeenAt: (data.lastSeenAt as Date | undefined) ?? new Date(),
          acknowledgedAt: null,
          acknowledgedBy: null,
          suppressUntil: (data.suppressUntil as Date | null | undefined) ?? null,
        };
        store.alerts.push(row);
        return row;
      },
      async update({ where, data }: { where: { dedupeKey?: string }; data: Record<string, unknown> }) {
        const tenantId = scopedTenantId();
        const row = store.alerts.find(
          (a) => a.dedupeKey === where.dedupeKey && (!tenantId || a.tenantId === tenantId),
        );
        if (!row) throw new Error('not found');
        if (data.lastSeenAt !== undefined) row.lastSeenAt = data.lastSeenAt as Date;
        if (data.status !== undefined) row.status = data.status as string;
        if (data.suppressUntil !== undefined) row.suppressUntil = data.suppressUntil as Date | null;
        return row;
      },
    },
    rawFile: {
      async findFirst() {
        return { ingestedAt: new Date() };
      },
    },
    interchange: {
      async findMany() {
        return [];
      },
    },
  } as unknown as PrismaClient;
}

function overdueFixture(tenantId: string, partnerId: string, txnId: string): {
  partner: FakePartner;
  txn: FakeTxn;
} {
  return {
    partner: {
      id: partnerId,
      tenantId,
      displayName: `Partner-${partnerId}`,
      isaSenderIds: ['US'],
      isaReceiverIds: ['PARTNER'],
      slaWindows: [{ setId: '810', direction: 'outbound', withinMinutes: 60 }],
      status: 'active',
    },
    txn: {
      id: txnId,
      tenantId,
      transactionSetId: '810',
      controlNumber: '1',
      direction: 'outbound',
      poNumber: null,
      ackedGroupControl: null,
      functionalGroup: {
        controlNumber: '100',
        interchange: {
          senderId: 'US',
          receiverId: 'PARTNER',
          rawFile: { ingestedAt: new Date('2026-06-18T08:00:00Z') },
        },
      },
    },
  };
}

function makeStore(): FakeStore {
  const pilot = overdueFixture(PILOT_TENANT_ID, 'p-pilot', 't-pilot');
  const tenantB = overdueFixture(TENANT_B, 'p-b', 't-b');
  return {
    tenants: [
      { id: PILOT_TENANT_ID, deletedAt: null },
      { id: TENANT_B, deletedAt: null },
    ],
    partners: [pilot.partner, tenantB.partner],
    txns: [pilot.txn, tenantB.txn],
    alerts: [],
    seq: 0,
  };
}

const notifier = {
  mode: 'disabled' as const,
  sesFrom: '',
  sesRegion: 'us-east-1',
  globalSlackWebhook: '',
};

test('runDetectionForAllTenants emits MISSING_ACK for each active tenant', async () => {
  const store = makeStore();
  const prisma = makePrisma(store);
  const now = new Date('2026-06-18T10:00:00Z');

  const results = await runDetectionForAllTenants(
    {
      prisma,
      notifier: { prisma, config: notifier },
      suppressionMinutes: 60,
      now: () => now,
    },
    {},
  );

  assert.equal(results.size, 2);
  assert.equal(results.get(PILOT_TENANT_ID)!.missing.emitted, 1);
  assert.equal(results.get(TENANT_B)!.missing.emitted, 1);
  assert.equal(store.alerts.length, 2);
  assert.deepEqual(
    new Set(store.alerts.map((a) => a.tenantId)),
    new Set([PILOT_TENANT_ID, TENANT_B]),
  );
});

test('runDetectionForAllTenants skips soft-deleted tenants', async () => {
  const store = makeStore();
  store.tenants.find((t) => t.id === TENANT_B)!.deletedAt = new Date('2026-06-01T00:00:00Z');
  const prisma = makePrisma(store);
  const now = new Date('2026-06-18T10:00:00Z');

  const results = await runDetectionForAllTenants(
    {
      prisma,
      notifier: { prisma, config: notifier },
      suppressionMinutes: 60,
      now: () => now,
    },
    {},
  );

  assert.equal(results.size, 1);
  assert.equal(results.has(TENANT_B), false);
  assert.equal(store.alerts.length, 1);
  assert.equal(store.alerts[0]!.tenantId, PILOT_TENANT_ID);
});

test('runDetectionForAllTenants does not leak tenantContext after it returns', async () => {
  const store = makeStore();
  const prisma = makePrisma(store);
  await runDetectionForAllTenants(
    {
      prisma,
      notifier: { prisma, config: notifier },
      suppressionMinutes: 60,
      now: () => new Date('2026-06-18T10:00:00Z'),
    },
    {},
  );
  assert.equal(tenantContext.current(), undefined);
});
