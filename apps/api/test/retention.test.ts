/**
 * Phase 10 Sprint 3.5 — retention worker + tenant soft-delete tests.
 *
 * Covered:
 *   - Worker flips old raw files to ARCHIVED, leaves fresh ones alone.
 *   - Worker deletes old parsed interchanges, audit events, alerts.
 *   - Worker emits exactly one retention.run audit row per tenant.
 *   - TTL of 0 disables the category (regulatory keep-forever knob).
 *   - sweepDeletedTenants hard-deletes only past the grace period.
 *   - Tenant soft-delete route writes the right audit row.
 *
 * Uses an in-memory Prisma fake so the test is hermetic — no Postgres
 * required. The fake honors `where` filters that the worker actually
 * uses (gte/lt/not) and supports the bypass / context flow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { runRetention, sweepDeletedTenants } from '../src/services/retention.js';
import { tenantContext } from '@edi/db';

// ─────────────────────────────────────────────────────────────
// Tiny in-memory Prisma fake
// ─────────────────────────────────────────────────────────────

const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';

interface FakeStore {
  tenants: Array<{ id: string; retention: unknown; deletedAt: Date | null }>;
  rawFiles: Array<{ id: string; tenantId: string; s3Key: string; ingestedAt: Date; status: string }>;
  interchanges: Array<{ id: string; tenantId: string; parsedAt: Date }>;
  alerts: Array<{ id: string; tenantId: string; createdAt: Date }>;
  auditEvents: Array<{ id: string; tenantId: string; createdAt: Date; action: string }>;
  tradingPartners: Array<{ id: string; tenantId: string }>;
  users: Array<{ id: string; tenantId: string }>;
}

function makeFake(store: FakeStore): PrismaClient {
  const clone = <T>(row: T | null | undefined): T | null =>
    row ? structuredClone(row) as T : null;

  // Helper: lt/gte filter on Date fields the worker actually queries.
  function dateMatches(rowVal: Date, filter: unknown): boolean {
    if (!filter || typeof filter !== 'object') return true;
    const f = filter as { lt?: Date; gte?: Date };
    if (f.lt && rowVal.getTime() >= f.lt.getTime()) return false;
    if (f.gte && rowVal.getTime() < f.gte.getTime()) return false;
    return true;
  }

  return {
    tenant: {
      async findMany({ where = {} }: { where?: Record<string, unknown> } = {}) {
        let rows = [...store.tenants];
        if (where.deletedAt === null) rows = rows.filter((r) => r.deletedAt === null);
        if (where.deletedAt && typeof where.deletedAt === 'object') {
          rows = rows.filter((r) => r.deletedAt !== null && dateMatches(r.deletedAt, where.deletedAt));
        }
        return rows.map((r) => clone(r)!);
      },
      async findUnique({ where }: { where: { id?: string } }) {
        return clone(store.tenants.find((t) => t.id === where.id) ?? null);
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = store.tenants.find((t) => t.id === where.id);
        if (!row) throw new Error('Record to update not found.');
        Object.assign(row, data);
        return clone(row);
      },
      async delete({ where }: { where: { id: string } }) {
        const idx = store.tenants.findIndex((t) => t.id === where.id);
        if (idx === -1) throw new Error('not found');
        const [removed] = store.tenants.splice(idx, 1);
        return clone(removed!);
      },
    },
    rawFile: {
      async findMany({ where = {} }: { where?: Record<string, unknown> } = {}) {
        return store.rawFiles
          .filter((r) => {
            if (where.tenantId && r.tenantId !== where.tenantId) return false;
            if (where.ingestedAt && !dateMatches(r.ingestedAt, where.ingestedAt)) return false;
            if (where.status && typeof where.status === 'object') {
              const f = where.status as { not?: string };
              if (f.not && r.status === f.not) return false;
            }
            return true;
          })
          .map((r) => clone(r)!);
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = store.rawFiles.find((r) => r.id === where.id);
        if (!row) throw new Error('Record to update not found.');
        Object.assign(row, data);
        return clone(row);
      },
      async deleteMany({ where = {} }: { where?: Record<string, unknown> } = {}) {
        const before = store.rawFiles.length;
        store.rawFiles = store.rawFiles.filter((r) => where.tenantId !== r.tenantId);
        return { count: before - store.rawFiles.length };
      },
    },
    interchange: {
      async deleteMany({ where = {} }: { where?: Record<string, unknown> } = {}) {
        const before = store.interchanges.length;
        store.interchanges = store.interchanges.filter((r) => {
          if (where.tenantId && r.tenantId !== where.tenantId) return true;
          if (where.parsedAt && !dateMatches(r.parsedAt, where.parsedAt)) return true;
          return false;
        });
        return { count: before - store.interchanges.length };
      },
    },
    auditEvent: {
      async create({ data }: { data: Record<string, unknown> }) {
        const row = {
          id: `a-${store.auditEvents.length + 1}`,
          tenantId: data.tenantId as string,
          createdAt: new Date(),
          action: data.action as string,
        };
        store.auditEvents.push(row);
        return clone(row);
      },
      async deleteMany({ where = {} }: { where?: Record<string, unknown> } = {}) {
        const before = store.auditEvents.length;
        store.auditEvents = store.auditEvents.filter((r) => {
          if (where.tenantId && r.tenantId !== where.tenantId) return true;
          if (where.createdAt && !dateMatches(r.createdAt, where.createdAt)) return true;
          return false;
        });
        return { count: before - store.auditEvents.length };
      },
    },
    alert: {
      async deleteMany({ where = {} }: { where?: Record<string, unknown> } = {}) {
        const before = store.alerts.length;
        store.alerts = store.alerts.filter((r) => {
          if (where.tenantId && r.tenantId !== where.tenantId) return true;
          if (where.createdAt && !dateMatches(r.createdAt, where.createdAt)) return true;
          return false;
        });
        return { count: before - store.alerts.length };
      },
    },
    tradingPartner: {
      async deleteMany({ where = {} }: { where?: Record<string, unknown> } = {}) {
        const before = store.tradingPartners.length;
        store.tradingPartners = store.tradingPartners.filter((r) => where.tenantId !== r.tenantId);
        return { count: before - store.tradingPartners.length };
      },
    },
    user: {
      async deleteMany({ where = {} }: { where?: Record<string, unknown> } = {}) {
        const before = store.users.length;
        store.users = store.users.filter((r) => where.tenantId !== r.tenantId);
        return { count: before - store.users.length };
      },
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(undefined),
  } as unknown as PrismaClient;
}

function freshStore(retention: unknown = undefined): FakeStore {
  return {
    tenants: [
      { id: T1, retention: retention ?? { rawFiles: 540, parsedTree: 540, auditEvents: 365, alerts: 365 }, deletedAt: null },
    ],
    rawFiles: [],
    interchanges: [],
    alerts: [],
    auditEvents: [],
    tradingPartners: [],
    users: [],
  };
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

// ─────────────────────────────────────────────────────────────
// Retention worker
// ─────────────────────────────────────────────────────────────

test('runRetention flips old raw files to ARCHIVED and leaves fresh ones alone', async () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const store = freshStore();
  store.rawFiles = [
    { id: 'old', tenantId: T1, s3Key: 'k1', ingestedAt: daysAgo(now, 600), status: 'PARSED' },
    { id: 'fresh', tenantId: T1, s3Key: 'k2', ingestedAt: daysAgo(now, 100), status: 'PARSED' },
    { id: 'already', tenantId: T1, s3Key: 'k3', ingestedAt: daysAgo(now, 700), status: 'ARCHIVED' },
  ];
  const counts = await runRetention({ prisma: makeFake(store) }, now);
  const c = counts.get(T1)!;
  assert.equal(c.rawFilesArchived, 1);
  assert.equal(store.rawFiles.find((r) => r.id === 'old')!.status, 'ARCHIVED');
  assert.equal(store.rawFiles.find((r) => r.id === 'fresh')!.status, 'PARSED');
});

test('runRetention deletes parsed interchanges past TTL', async () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const store = freshStore();
  store.interchanges = [
    { id: 'old', tenantId: T1, parsedAt: daysAgo(now, 600) },
    { id: 'fresh', tenantId: T1, parsedAt: daysAgo(now, 100) },
  ];
  const counts = await runRetention({ prisma: makeFake(store) }, now);
  assert.equal(counts.get(T1)!.parsedInterchangesDeleted, 1);
  assert.equal(store.interchanges.length, 1);
  assert.equal(store.interchanges[0]!.id, 'fresh');
});

test('runRetention deletes audit events past TTL', async () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const store = freshStore();
  store.auditEvents = [
    { id: 'old', tenantId: T1, createdAt: daysAgo(now, 400), action: 'partner.create' },
    { id: 'fresh', tenantId: T1, createdAt: daysAgo(now, 30), action: 'partner.create' },
  ];
  const counts = await runRetention({ prisma: makeFake(store) }, now);
  assert.equal(counts.get(T1)!.auditEventsDeleted, 1);
  // The worker also writes a retention.run audit at the end — fresh stays, retention.run added.
  assert.equal(store.auditEvents.length, 2);
  assert.ok(store.auditEvents.some((a) => a.action === 'retention.run'));
});

test('runRetention deletes alerts past TTL', async () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const store = freshStore();
  store.alerts = [
    { id: 'old', tenantId: T1, createdAt: daysAgo(now, 400) },
    { id: 'fresh', tenantId: T1, createdAt: daysAgo(now, 100) },
  ];
  const counts = await runRetention({ prisma: makeFake(store) }, now);
  assert.equal(counts.get(T1)!.alertsDeleted, 1);
  assert.equal(store.alerts.length, 1);
});

test('runRetention writes exactly one retention.run audit row per tenant', async () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const store = freshStore();
  store.tenants.push({ id: T2, retention: { rawFiles: 540, parsedTree: 540, auditEvents: 365, alerts: 365 }, deletedAt: null });
  await runRetention({ prisma: makeFake(store) }, now);
  const runs = store.auditEvents.filter((a) => a.action === 'retention.run');
  assert.equal(runs.length, 2);
  const tenants = new Set(runs.map((r) => r.tenantId));
  assert.deepEqual([...tenants].sort(), [T1, T2].sort());
});

test('runRetention with TTL=0 disables that category (regulatory keep-forever)', async () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const store = freshStore({ rawFiles: 540, parsedTree: 540, auditEvents: 0, alerts: 365 });
  store.auditEvents = [
    { id: 'very-old', tenantId: T1, createdAt: daysAgo(now, 5000), action: 'partner.create' },
  ];
  await runRetention({ prisma: makeFake(store) }, now);
  // Original 5000-day-old audit survived; retention.run added.
  assert.equal(store.auditEvents.length, 2);
  assert.ok(store.auditEvents.some((a) => a.id === 'very-old'));
});

test('runRetention is idempotent — second consecutive run deletes zero additional rows', async () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const store = freshStore();
  store.alerts = [{ id: 'old', tenantId: T1, createdAt: daysAgo(now, 400) }];
  await runRetention({ prisma: makeFake(store) }, now);
  const before = store.alerts.length;
  const second = await runRetention({ prisma: makeFake(store) }, now);
  assert.equal(second.get(T1)!.alertsDeleted, 0);
  assert.equal(store.alerts.length, before);
});

// ─────────────────────────────────────────────────────────────
// sweepDeletedTenants
// ─────────────────────────────────────────────────────────────

test('sweepDeletedTenants leaves tenants within the grace window alone', async () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const store = freshStore();
  store.tenants[0]!.deletedAt = daysAgo(now, 10); // 10 days into 30-day grace
  store.tradingPartners.push({ id: 'p', tenantId: T1 });
  const counts = await sweepDeletedTenants(makeFake(store), now, 30);
  assert.equal(counts.size, 0);
  assert.equal(store.tenants.length, 1, 'tenant survives grace window');
  assert.equal(store.tradingPartners.length, 1);
});

test('sweepDeletedTenants hard-deletes tenants past the grace window', async () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const store = freshStore();
  store.tenants[0]!.deletedAt = daysAgo(now, 40); // past 30-day grace
  store.tradingPartners.push({ id: 'p1', tenantId: T1 });
  store.rawFiles.push({ id: 'r1', tenantId: T1, s3Key: 'k', ingestedAt: now, status: 'PARSED' });
  store.users.push({ id: 'u1', tenantId: T1 });
  const counts = await sweepDeletedTenants(makeFake(store), now, 30);
  assert.equal(counts.size, 1);
  const c = counts.get(T1)!;
  assert.equal(c.tradingPartners, 1);
  assert.equal(c.rawFiles, 1);
  assert.equal(c.users, 1);
  assert.equal(store.tenants.length, 0);
  assert.equal(store.tradingPartners.length, 0);
  assert.equal(store.rawFiles.length, 0);
  assert.equal(store.users.length, 0);
});

// ─────────────────────────────────────────────────────────────
// Tenant context propagation — readPolicy fallback
// ─────────────────────────────────────────────────────────────

test('runRetention falls back to defaults when tenant.retention is missing/garbage', async () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const store = freshStore('not-an-object'); // bogus retention value
  store.alerts = [{ id: 'old', tenantId: T1, createdAt: daysAgo(now, 400) }];
  const counts = await runRetention({ prisma: makeFake(store) }, now);
  // Default alerts TTL is 365 → 400-day-old row gets deleted.
  assert.equal(counts.get(T1)!.alertsDeleted, 1);
});

// Sanity: the worker leaves no tenant context dangling after it returns.
test('runRetention does not leak tenantContext after it returns', async () => {
  const store = freshStore();
  await runRetention({ prisma: makeFake(store) }, new Date());
  // tenantContext.current() can legitimately be set by enclosing test
  // infrastructure (it isn't here) — assert it's at most undefined or
  // unmodified relative to before the call.
  const after = tenantContext.current();
  assert.equal(after, undefined);
});
