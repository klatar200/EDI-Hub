/**
 * Phase 7 Sprint 1 — detection tests.
 *
 * Time-travel via an explicit `now` so we don't depend on wall-clock. The
 * in-memory Prisma fake supports just enough Prisma surface for the detector
 * to do its job (tradingPartner.findMany + transaction.findMany).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { detectMissingAcks, detectRejectionSpikes, detectUnknownIsaSenders } from '../src/services/detection.js';

type Dir = 'inbound' | 'outbound' | 'unknown';

interface FakeTxn {
  id: string;
  transactionSetId: string;
  controlNumber: string;
  direction: Dir;
  poNumber: string | null;
  ackedGroupControl?: string | null;
  ackedTxnControls?: Array<{ setId: string; control: string; status: string }>;
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
  displayName: string;
  isaSenderIds: string[];
  isaReceiverIds: string[];
  slaWindows: Array<{ setId: string; direction: Dir; withinMinutes: number; expectedAckSetId?: string }>;
  status: 'active' | 'disabled';
}

interface FakeAlert {
  id: string; partnerId: string | null; type: string; severity: string;
  title: string; body: string; dedupeKey: string; sourceRef: unknown;
  status: string; createdAt: Date; lastSeenAt: Date;
  acknowledgedAt: Date | null; acknowledgedBy: string | null; suppressUntil: Date | null;
}

interface FakeInterchange {
  senderId: string;
  receiverId: string;
  rawFileId: string;
  ingestedAt: Date;
}

interface World {
  partners: FakePartner[];
  txns: FakeTxn[];
  alerts: FakeAlert[];
  interchanges: FakeInterchange[];
  seq: number;
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
    if (typeof v === 'object' && Array.isArray(v.in) && (!t.ackedGroupControl || !v.in.includes(t.ackedGroupControl))) return false;
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
        return s.includes(t.functionalGroup.interchange.senderId) ||
               r.includes(t.functionalGroup.interchange.receiverId);
      });
      if (!any) return false;
    }
  }
  return true;
}

function makePrisma(world: World): PrismaClient {
  return {
    tradingPartner: {
      async findMany({ where }: { where?: { status?: 'active' | 'disabled' } } = {}) {
        return world.partners.filter((p) => !where?.status || p.status === where.status);
      },
    },
    transaction: {
      async findMany({ where }: { where: Record<string, unknown> }) {
        return world.txns.filter((t) => txnMatches(t, where));
      },
    },
    alert: {
      async findUnique({ where }: { where: { dedupeKey?: string } }) {
        return world.alerts.find((a) => a.dedupeKey === where.dedupeKey) ?? null;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row: FakeAlert = {
          id: `a-${(world.seq += 1)}`,
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
          acknowledgedAt: null, acknowledgedBy: null,
          suppressUntil: (data.suppressUntil as Date | null | undefined) ?? null,
        };
        world.alerts.push(row);
        return row;
      },
      async update({ where, data }: { where: { dedupeKey?: string }; data: Record<string, unknown> }) {
        const row = world.alerts.find((a) => a.dedupeKey === where.dedupeKey);
        if (!row) throw new Error('not found');
        if (data.lastSeenAt !== undefined) row.lastSeenAt = data.lastSeenAt as Date;
        if (data.status !== undefined) row.status = data.status as string;
        if (data.suppressUntil !== undefined) row.suppressUntil = data.suppressUntil as Date | null;
        return row;
      },
    },
    interchange: {
      async findMany({ where }: { where?: { rawFile?: { ingestedAt?: { gte?: Date } } } } = {}) {
        const gte = where?.rawFile?.ingestedAt?.gte;
        let rows = world.interchanges;
        if (gte) rows = rows.filter((ic) => ic.ingestedAt >= gte);
        const seen = new Set<string>();
        return rows.filter((ic) => {
          const key = `${ic.senderId}::${ic.receiverId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).map((ic) => ({
          senderId: ic.senderId,
          receiverId: ic.receiverId,
          rawFileId: ic.rawFileId,
        }));
      },
    },
  } as unknown as PrismaClient;
}

function buildPartner(o: Partial<FakePartner> & { id: string; displayName: string }): FakePartner {
  return {
    id: o.id, displayName: o.displayName,
    isaSenderIds: o.isaSenderIds ?? [],
    isaReceiverIds: o.isaReceiverIds ?? [],
    slaWindows: o.slaWindows ?? [],
    status: o.status ?? 'active',
  };
}

function buildTxn(o: Partial<FakeTxn> & {
  id: string; transactionSetId: string; controlNumber: string; direction: Dir;
  groupControl: string; ingestedAt: string; senderId?: string; receiverId?: string;
}): FakeTxn {
  return {
    id: o.id, transactionSetId: o.transactionSetId, controlNumber: o.controlNumber,
    direction: o.direction,
    poNumber: o.poNumber ?? null,
    ackedGroupControl: o.ackedGroupControl ?? null,
    ackedTxnControls: o.ackedTxnControls,
    functionalGroup: {
      controlNumber: o.groupControl,
      interchange: {
        senderId: o.senderId ?? 'SENDER',
        receiverId: o.receiverId ?? 'RECEIVER',
        rawFile: { ingestedAt: new Date(o.ingestedAt) },
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Missing-ack detector
// ─────────────────────────────────────────────────────────────

test('emits MISSING_ACK for an outbound txn past the SLA window with no matching 997', async () => {
  const world: World = {
    partners: [
      buildPartner({
        id: 'p-sysco', displayName: 'Sysco',
        isaSenderIds: ['US'], isaReceiverIds: ['SYSCO'],
        slaWindows: [{ setId: '810', direction: 'outbound', withinMinutes: 60 }],
      }),
    ],
    txns: [
      buildTxn({
        id: 't-810', transactionSetId: '810', controlNumber: '1', direction: 'outbound',
        groupControl: '100', ingestedAt: '2026-06-18T08:00:00Z',
        senderId: 'US', receiverId: 'SYSCO',
      }),
    ],
    interchanges: [],
    alerts: [], seq: 0,
  };
  const prisma = makePrisma(world);
  const now = new Date('2026-06-18T10:00:00Z'); // 2h later — SLA was 60 min.
  const result = await detectMissingAcks(prisma, now);
  assert.equal(result.emitted, 1);
  assert.equal(world.alerts.length, 1);
  assert.equal(world.alerts[0]!.type, 'MISSING_ACK');
  assert.equal(world.alerts[0]!.dedupeKey, 'MISSING_ACK::p-sysco::t-810');
});

test('does not emit when a matching 997 ack is present', async () => {
  const world: World = {
    partners: [
      buildPartner({
        id: 'p-sysco', displayName: 'Sysco',
        isaSenderIds: ['US'], isaReceiverIds: ['SYSCO'],
        slaWindows: [{ setId: '810', direction: 'outbound', withinMinutes: 60 }],
      }),
    ],
    txns: [
      buildTxn({
        id: 't-810', transactionSetId: '810', controlNumber: '1', direction: 'outbound',
        groupControl: '100', ingestedAt: '2026-06-18T08:00:00Z',
        senderId: 'US', receiverId: 'SYSCO',
      }),
      buildTxn({
        id: 't-ack', transactionSetId: '997', controlNumber: '9001', direction: 'inbound',
        groupControl: '200', ingestedAt: '2026-06-18T08:30:00Z',
        senderId: 'SYSCO', receiverId: 'US',
        ackedGroupControl: '100',
        ackedTxnControls: [{ setId: '810', control: '1', status: 'A' }],
      }),
    ],
    interchanges: [],
    alerts: [], seq: 0,
  };
  const prisma = makePrisma(world);
  const result = await detectMissingAcks(prisma, new Date('2026-06-18T10:00:00Z'));
  assert.equal(result.emitted, 0);
  assert.equal(world.alerts.length, 0);
});

test('idempotent on rerun: same condition, same dedupeKey, no duplicate alert', async () => {
  const world: World = {
    partners: [
      buildPartner({
        id: 'p-sysco', displayName: 'Sysco',
        isaSenderIds: ['US'], isaReceiverIds: ['SYSCO'],
        slaWindows: [{ setId: '810', direction: 'outbound', withinMinutes: 60 }],
      }),
    ],
    txns: [
      buildTxn({
        id: 't-810', transactionSetId: '810', controlNumber: '1', direction: 'outbound',
        groupControl: '100', ingestedAt: '2026-06-18T08:00:00Z',
        senderId: 'US', receiverId: 'SYSCO',
      }),
    ],
    interchanges: [],
    alerts: [], seq: 0,
  };
  const prisma = makePrisma(world);
  const now = new Date('2026-06-18T10:00:00Z');
  await detectMissingAcks(prisma, now);
  await detectMissingAcks(prisma, new Date('2026-06-18T10:05:00Z'));
  assert.equal(world.alerts.length, 1);
});

test('does not emit when the txn is still within the SLA window', async () => {
  const world: World = {
    partners: [
      buildPartner({
        id: 'p-sysco', displayName: 'Sysco',
        isaSenderIds: ['US'], isaReceiverIds: ['SYSCO'],
        slaWindows: [{ setId: '810', direction: 'outbound', withinMinutes: 60 }],
      }),
    ],
    txns: [
      buildTxn({
        id: 't-810', transactionSetId: '810', controlNumber: '1', direction: 'outbound',
        groupControl: '100', ingestedAt: '2026-06-18T09:30:00Z',
        senderId: 'US', receiverId: 'SYSCO',
      }),
    ],
    interchanges: [],
    alerts: [], seq: 0,
  };
  const prisma = makePrisma(world);
  const now = new Date('2026-06-18T10:00:00Z'); // only 30 min later — still within 60min SLA
  const result = await detectMissingAcks(prisma, now);
  assert.equal(result.emitted, 0);
});

// ─────────────────────────────────────────────────────────────
// Rejection-rate spike detector
// ─────────────────────────────────────────────────────────────

function buildAckTxn(id: string, ingestedAt: string, entries: Array<{ setId: string; control: string; status: string }>): FakeTxn {
  return buildTxn({
    id, transactionSetId: '997', controlNumber: id, direction: 'inbound',
    groupControl: id, ingestedAt,
    senderId: 'SYSCO', receiverId: 'US',
    ackedGroupControl: 'g',
    ackedTxnControls: entries,
  });
}

test('emits REJECTION_RATE_SPIKE when current rate jumps absolutely from low baseline', async () => {
  const txns: FakeTxn[] = [];
  // 30-day baseline: 100 acks, 2 rejected → 2% baseline.
  for (let i = 0; i < 50; i++) {
    txns.push(buildAckTxn(`b-${i}`, '2026-06-01T00:00:00Z',
      [{ setId: '850', control: String(i), status: 'A' }, { setId: '850', control: String(i)+'b', status: 'A' }]));
  }
  txns.push(buildAckTxn('b-rej', '2026-06-01T00:00:00Z',
    [{ setId: '850', control: 'X1', status: 'R' }, { setId: '850', control: 'X2', status: 'R' }]));
  // Current 24h: 15 acks, 3 rejected → 20% current → ≥10pp jump.
  txns.push(buildAckTxn('c-1', '2026-06-17T22:00:00Z',
    [{ setId: '850', control: 'C1', status: 'R' }, { setId: '850', control: 'C2', status: 'R' },
     { setId: '850', control: 'C3', status: 'R' }, { setId: '850', control: 'C4', status: 'A' }]));
  for (let i = 0; i < 11; i++) {
    txns.push(buildAckTxn(`c-fill-${i}`, '2026-06-17T22:30:00Z',
      [{ setId: '850', control: 'fill', status: 'A' }]));
  }
  const world: World = {
    partners: [
      buildPartner({
        id: 'p-sysco', displayName: 'Sysco',
        isaSenderIds: ['SYSCO'], isaReceiverIds: ['US'],
      }),
    ],
    txns, interchanges: [], alerts: [], seq: 0,
  };
  const prisma = makePrisma(world);
  const result = await detectRejectionSpikes(prisma, new Date('2026-06-18T00:00:00Z'));
  assert.equal(result.emitted, 1);
  assert.equal(world.alerts[0]!.type, 'REJECTION_RATE_SPIKE');
});

test('does NOT emit when current rate stays near baseline', async () => {
  const txns: FakeTxn[] = [];
  // Baseline 2%; current also 2% → no spike.
  for (let i = 0; i < 50; i++) {
    txns.push(buildAckTxn(`b-${i}`, '2026-06-01T00:00:00Z',
      [{ setId: '850', control: String(i), status: 'A' }]));
  }
  txns.push(buildAckTxn('b-rej', '2026-06-01T00:00:00Z', [{ setId: '850', control: 'X', status: 'R' }]));
  // Current 24h: 50 acks, 1 rejected = 2%.
  for (let i = 0; i < 49; i++) {
    txns.push(buildAckTxn(`c-${i}`, '2026-06-17T22:00:00Z',
      [{ setId: '850', control: 'c', status: 'A' }]));
  }
  txns.push(buildAckTxn('c-rej', '2026-06-17T22:00:00Z', [{ setId: '850', control: 'cr', status: 'R' }]));
  const world: World = {
    partners: [buildPartner({ id: 'p-sysco', displayName: 'Sysco', isaSenderIds: ['SYSCO'], isaReceiverIds: ['US'] })],
    txns, interchanges: [], alerts: [], seq: 0,
  };
  const prisma = makePrisma(world);
  const result = await detectRejectionSpikes(prisma, new Date('2026-06-18T00:00:00Z'));
  assert.equal(result.emitted, 0);
});

test('does NOT emit when baseline total is below the minimum required', async () => {
  const txns: FakeTxn[] = [
    // Only 5 acks in window — below MIN_TOTAL_FOR_SPIKE (10).
    buildAckTxn('b-1', '2026-06-17T22:00:00Z', [
      { setId: '850', control: '1', status: 'R' }, { setId: '850', control: '2', status: 'R' },
      { setId: '850', control: '3', status: 'A' }, { setId: '850', control: '4', status: 'A' },
      { setId: '850', control: '5', status: 'A' },
    ]),
  ];
  const world: World = {
    partners: [buildPartner({ id: 'p-sysco', displayName: 'Sysco', isaSenderIds: ['SYSCO'], isaReceiverIds: ['US'] })],
    txns, interchanges: [], alerts: [], seq: 0,
  };
  const prisma = makePrisma(world);
  const result = await detectRejectionSpikes(prisma, new Date('2026-06-18T00:00:00Z'));
  assert.equal(result.emitted, 0);
});

// ─────────────────────────────────────────────────────────────
// Phase 7 Sprint 3 — sourceRef enrichment + initial suppression
// ─────────────────────────────────────────────────────────────

test('MISSING_ACK alert sourceRef includes the txn poNumber when available', async () => {
  const world: World = {
    partners: [
      buildPartner({
        id: 'p-sysco', displayName: 'Sysco',
        isaSenderIds: ['US'], isaReceiverIds: ['SYSCO'],
        slaWindows: [{ setId: '810', direction: 'outbound', withinMinutes: 60 }],
      }),
    ],
    txns: [
      buildTxn({
        id: 't-810', transactionSetId: '810', controlNumber: '1', direction: 'outbound',
        groupControl: '100', ingestedAt: '2026-06-18T08:00:00Z',
        senderId: 'US', receiverId: 'SYSCO',
        poNumber: 'PO-12345',
      }),
    ],
    interchanges: [],
    alerts: [], seq: 0,
  };
  const prisma = makePrisma(world);
  const result = await detectMissingAcks(prisma, new Date('2026-06-18T10:00:00Z'));
  assert.equal(result.emitted, 1);
  const sr = world.alerts[0]!.sourceRef as { poNumber?: string };
  assert.equal(sr.poNumber, 'PO-12345');
});

test('detection sets initial suppressUntil when suppressionMinutes is provided', async () => {
  const world: World = {
    partners: [
      buildPartner({
        id: 'p-sysco', displayName: 'Sysco',
        isaSenderIds: ['US'], isaReceiverIds: ['SYSCO'],
        slaWindows: [{ setId: '810', direction: 'outbound', withinMinutes: 60 }],
      }),
    ],
    txns: [
      buildTxn({
        id: 't-810', transactionSetId: '810', controlNumber: '1', direction: 'outbound',
        groupControl: '100', ingestedAt: '2026-06-18T08:00:00Z',
        senderId: 'US', receiverId: 'SYSCO',
      }),
    ],
    interchanges: [],
    alerts: [], seq: 0,
  };
  const prisma = makePrisma(world);
  const now = new Date('2026-06-18T10:00:00Z');
  await detectMissingAcks(prisma, now, { suppressionMinutes: 60 });
  const sup = world.alerts[0]!.suppressUntil;
  assert.ok(sup);
  assert.equal(sup!.toISOString(), '2026-06-18T11:00:00.000Z');
});

test('emits UNKNOWN_ISA when recent interchange IDs match no partner', async () => {
  const world: World = {
    partners: [
      buildPartner({
        id: 'p-known', displayName: 'Known',
        isaSenderIds: ['KNOWN'], isaReceiverIds: ['HUB'],
      }),
    ],
    txns: [],
    interchanges: [
      {
        senderId: 'STRANGER',
        receiverId: 'HUB',
        rawFileId: 'rf-1',
        ingestedAt: new Date('2026-06-18T09:00:00Z'),
      },
    ],
    alerts: [], seq: 0,
  };
  const prisma = makePrisma(world);
  const now = new Date('2026-06-18T10:00:00Z');
  const result = await detectUnknownIsaSenders(prisma, now);
  assert.equal(result.emitted, 1);
  assert.equal(world.alerts[0]!.type, 'UNKNOWN_ISA');
  assert.equal(world.alerts[0]!.dedupeKey, 'UNKNOWN_ISA::STRANGER::HUB');
});

