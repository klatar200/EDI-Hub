/**
 * Phase 7 Sprint 1 — alerts service tests (create dedupe + list + ack).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { acknowledgeAlert, createAlert, getAlert, listAlerts, snoozeAlert } from '../src/services/alerts.js';
import type { AlertStatus, AlertSeverity, AlertType } from '@edi/shared';

interface AlertFake {
  id: string;
  partnerId: string | null;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  dedupeKey: string;
  sourceRef: unknown;
  status: AlertStatus;
  createdAt: Date;
  lastSeenAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  suppressUntil: Date | null;
}

interface Store { rows: AlertFake[]; seq: number }

function makePrisma(store: Store): PrismaClient {
  return {
    alert: {
      async findUnique({ where }: { where: { id?: string; dedupeKey?: string } }) {
        return store.rows.find((r) =>
          (where.id !== undefined && r.id === where.id) ||
          (where.dedupeKey !== undefined && r.dedupeKey === where.dedupeKey),
        ) ?? null;
      },
      async findMany({ where, orderBy: _o }: { where?: Record<string, unknown>; orderBy?: unknown } = {}) {
        void _o;
        return store.rows.filter((r) => {
          if (!where) return true;
          if (where.status && r.status !== where.status) return false;
          if (where.type && r.type !== where.type) return false;
          if (where.partnerId && r.partnerId !== where.partnerId) return false;
          if (where.createdAt) {
            const range = where.createdAt as { gte?: Date; lte?: Date };
            if (range.gte && r.createdAt < range.gte) return false;
            if (range.lte && r.createdAt > range.lte) return false;
          }
          return true;
        });
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row: AlertFake = {
          id: `a-${(store.seq += 1)}`,
          partnerId: (data.partnerId as string | null | undefined) ?? null,
          type: data.type as AlertType,
          severity: (data.severity as AlertSeverity | undefined) ?? 'warning',
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
        store.rows.push(row);
        return row;
      },
      async update({ where, data }: { where: { id?: string; dedupeKey?: string }; data: Record<string, unknown> }) {
        const row = store.rows.find((r) =>
          (where.id !== undefined && r.id === where.id) ||
          (where.dedupeKey !== undefined && r.dedupeKey === where.dedupeKey),
        );
        if (!row) throw new Error('not found');
        if (data.title !== undefined) row.title = data.title as string;
        if (data.body !== undefined) row.body = data.body as string;
        if (data.severity !== undefined) row.severity = data.severity as AlertSeverity;
        if (data.lastSeenAt !== undefined) row.lastSeenAt = data.lastSeenAt as Date;
        if (data.status !== undefined) row.status = data.status as AlertStatus;
        if (data.acknowledgedAt !== undefined) row.acknowledgedAt = data.acknowledgedAt as Date | null;
        if (data.acknowledgedBy !== undefined) row.acknowledgedBy = data.acknowledgedBy as string | null;
        if (data.sourceRef !== undefined) row.sourceRef = data.sourceRef;
        if (data.suppressUntil !== undefined) row.suppressUntil = data.suppressUntil as Date | null;
        return row;
      },
    },
  } as unknown as PrismaClient;
}

function newStore(): { store: Store; prisma: PrismaClient } {
  const store: Store = { rows: [], seq: 0 };
  return { store, prisma: makePrisma(store) };
}

test('createAlert inserts a new row when dedupeKey is unseen (outcome=created)', async () => {
  const { prisma, store } = newStore();
  const r = await createAlert(prisma, {
    partnerId: 'p-1', type: 'MISSING_ACK', title: 'foo', body: 'bar', dedupeKey: 'k-1',
  });
  assert.equal(r.alert.type, 'MISSING_ACK');
  assert.equal(r.alert.status, 'active');
  assert.equal(r.outcome, 'created');
  assert.equal(store.rows.length, 1);
});

test('createAlert is idempotent on dedupeKey: outcome=updated, no duplicate row', async () => {
  const { prisma, store } = newStore();
  const t0 = new Date('2026-06-18T10:00:00Z');
  const t1 = new Date('2026-06-18T11:00:00Z');
  await createAlert(prisma, { partnerId: 'p', type: 'MISSING_ACK', title: 'a', body: 'b', dedupeKey: 'k', now: t0 });
  const second = await createAlert(prisma, { partnerId: 'p', type: 'MISSING_ACK', title: 'a', body: 'b', dedupeKey: 'k', now: t1 });
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0]!.lastSeenAt.toISOString(), t1.toISOString());
  assert.equal(second.outcome, 'updated');
});

test('createAlert reactivates an acknowledged alert when suppression has expired (outcome=reactivated)', async () => {
  const { prisma, store } = newStore();
  const t0 = new Date('2026-06-18T10:00:00Z');
  await createAlert(prisma, { partnerId: 'p', type: 'MISSING_ACK', title: 'a', body: 'b', dedupeKey: 'k', now: t0 });
  await acknowledgeAlert(prisma, store.rows[0]!.id, 'ops', t0);
  assert.equal(store.rows[0]!.status, 'acknowledged');
  // Rerun with no suppressUntil → status should flip back to active.
  const t1 = new Date('2026-06-18T13:00:00Z');
  const r = await createAlert(prisma, { partnerId: 'p', type: 'MISSING_ACK', title: 'a', body: 'b', dedupeKey: 'k', now: t1 });
  assert.equal(store.rows[0]!.status, 'active');
  assert.equal(store.rows[0]!.acknowledgedAt, null);
  assert.equal(r.outcome, 'reactivated');
});

test('listAlerts filters by status and type', async () => {
  const { prisma, store } = newStore();
  await createAlert(prisma, { partnerId: 'p', type: 'MISSING_ACK', title: 'a', body: 'b', dedupeKey: 'k1' });
  await createAlert(prisma, { partnerId: 'p', type: 'REJECTION_RATE_SPIKE', title: 'c', body: 'd', dedupeKey: 'k2' });
  await acknowledgeAlert(prisma, store.rows[0]!.id, 'ops');
  const activeOnly = await listAlerts(prisma, { status: 'active' });
  assert.equal(activeOnly.length, 1);
  assert.equal(activeOnly[0]!.type, 'REJECTION_RATE_SPIKE');
  const spikes = await listAlerts(prisma, { type: 'REJECTION_RATE_SPIKE' });
  assert.equal(spikes.length, 1);
});

test('acknowledgeAlert marks status + actor + timestamp', async () => {
  const { prisma, store } = newStore();
  await createAlert(prisma, { partnerId: null, type: 'STALE_TRAFFIC', title: 'a', body: 'b', dedupeKey: 'k' });
  const t = new Date('2026-06-18T15:00:00Z');
  const ack = await acknowledgeAlert(prisma, store.rows[0]!.id, 'keagan', t);
  assert.ok(ack);
  assert.equal(ack!.status, 'acknowledged');
  assert.equal(ack!.acknowledgedBy, 'keagan');
  assert.equal(ack!.acknowledgedAt, t.toISOString());
});

test('getAlert returns null for an unknown id', async () => {
  const { prisma } = newStore();
  assert.equal(await getAlert(prisma, 'no-such'), null);
});

// ─────────────────────────────────────────────────────────────
// Phase 7 Sprint 3 — suppression + snooze
// ─────────────────────────────────────────────────────────────

test('createAlert honors initial suppressUntil on creation', async () => {
  const { prisma, store } = newStore();
  const now = new Date('2026-06-18T10:00:00Z');
  const until = new Date('2026-06-18T11:00:00Z');
  await createAlert(prisma, {
    partnerId: 'p', type: 'MISSING_ACK', title: 'a', body: 'b',
    dedupeKey: 'k', now, suppressUntil: until,
  });
  assert.equal(store.rows[0]!.suppressUntil?.toISOString(), until.toISOString());
});

test('acknowledgeAlert bumps suppressUntil so reruns don\'t reactivate immediately', async () => {
  const { prisma, store } = newStore();
  const t0 = new Date('2026-06-18T10:00:00Z');
  await createAlert(prisma, { partnerId: 'p', type: 'MISSING_ACK', title: 'a', body: 'b', dedupeKey: 'k', now: t0 });
  await acknowledgeAlert(prisma, store.rows[0]!.id, 'ops', t0, 60);
  assert.ok(store.rows[0]!.suppressUntil);
  // Rerun 10 minutes later — within the suppression window → outcome=updated, not reactivated.
  const t1 = new Date('2026-06-18T10:10:00Z');
  const second = await createAlert(prisma, { partnerId: 'p', type: 'MISSING_ACK', title: 'a', body: 'b', dedupeKey: 'k', now: t1 });
  assert.equal(second.outcome, 'updated');
  assert.equal(store.rows[0]!.status, 'acknowledged');
});

test('createAlert reactivates after acknowledgement once suppression expires', async () => {
  const { prisma, store } = newStore();
  const t0 = new Date('2026-06-18T10:00:00Z');
  await createAlert(prisma, { partnerId: 'p', type: 'MISSING_ACK', title: 'a', body: 'b', dedupeKey: 'k', now: t0 });
  await acknowledgeAlert(prisma, store.rows[0]!.id, 'ops', t0, 60);
  // 2 hours later, the 60-minute suppression has expired.
  const t1 = new Date('2026-06-18T12:00:00Z');
  const second = await createAlert(prisma, { partnerId: 'p', type: 'MISSING_ACK', title: 'a', body: 'b', dedupeKey: 'k', now: t1 });
  assert.equal(second.outcome, 'reactivated');
  assert.equal(store.rows[0]!.status, 'active');
});

test('snoozeAlert sets suppressUntil without changing status', async () => {
  const { prisma, store } = newStore();
  const t0 = new Date('2026-06-18T10:00:00Z');
  await createAlert(prisma, { partnerId: 'p', type: 'MISSING_ACK', title: 'a', body: 'b', dedupeKey: 'k', now: t0 });
  const result = await snoozeAlert(prisma, store.rows[0]!.id, 240, t0);
  assert.ok(result);
  assert.equal(result!.status, 'active');
  assert.equal(store.rows[0]!.suppressUntil?.toISOString(), '2026-06-18T14:00:00.000Z');
});

test('snoozeAlert returns null for an unknown id', async () => {
  const { prisma } = newStore();
  assert.equal(await snoozeAlert(prisma, 'nope', 60), null);
});

