/**
 * Per-partner rejection-rate metric tests — Phase 5 Sprint 2.
 *
 * Exercises `getRejectionRate` against an in-memory Prisma fake. Validates:
 *   - aggregation math (rate = rejected / total per partner)
 *   - the strict rejection definition (Gate C): only AK5=R or M count
 *   - window filtering by ingestedAt
 *   - partner filter
 *   - partner derivation via OUR_ISA_IDS (the side that isn't us)
 *   - sort order (highest rate first)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { getRejectionRate } from '../src/services/metrics.js';

interface FakeAck {
  ackedTxnControls: Array<{ setId: string; control: string; status: string }>;
  functionalGroup: {
    interchange: {
      senderId: string;
      receiverId: string;
      rawFile: { ingestedAt: Date };
    };
  };
}

function ack(args: {
  senderId: string;
  receiverId: string;
  ingestedAt: string;
  entries: Array<{ setId: string; control: string; status: string }>;
}): FakeAck {
  return {
    ackedTxnControls: args.entries,
    functionalGroup: {
      interchange: {
        senderId: args.senderId,
        receiverId: args.receiverId,
        rawFile: { ingestedAt: new Date(args.ingestedAt) },
      },
    },
  };
}

function makePrisma(acks: FakeAck[]): PrismaClient {
  function withinWindow(d: Date, gte: Date, lte: Date): boolean {
    return d.getTime() >= gte.getTime() && d.getTime() <= lte.getTime();
  }
  return {
    transaction: {
      async findMany({ where }: { where: Record<string, unknown> }) {
        const wf = (where.functionalGroup as { interchange?: { rawFile?: { ingestedAt?: { gte?: Date; lte?: Date } } } })
          ?.interchange?.rawFile?.ingestedAt;
        const gte = wf?.gte;
        const lte = wf?.lte;
        return acks.filter((a) => {
          if (gte && lte) return withinWindow(a.functionalGroup.interchange.rawFile.ingestedAt, gte, lte);
          return true;
        });
      },
    },
  } as unknown as PrismaClient;
}

test('aggregates total and rejected per partner; strict R/M only', async () => {
  const prisma = makePrisma([
    ack({
      senderId: 'ACME', receiverId: 'US', ingestedAt: '2026-06-01T10:00:00Z',
      entries: [
        { setId: '850', control: '1', status: 'A' },
        { setId: '850', control: '2', status: 'R' },
        { setId: '850', control: '3', status: 'E' }, // E does NOT count
      ],
    }),
    ack({
      senderId: 'GLOBEX', receiverId: 'US', ingestedAt: '2026-06-02T10:00:00Z',
      entries: [
        { setId: '855', control: '1', status: 'M' }, // M counts as rejected
        { setId: '855', control: '2', status: 'A' },
      ],
    }),
  ]);
  const rows = await getRejectionRate(prisma, {
    from: new Date('2026-05-01T00:00:00Z'),
    to: new Date('2026-07-01T00:00:00Z'),
    ourIsaIds: ['US'],
  });
  // Sorted by rate desc — GLOBEX (1/2 = 0.5) before ACME (1/3 ≈ 0.33).
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.partner, 'GLOBEX');
  assert.equal(rows[0]!.total, 2);
  assert.equal(rows[0]!.rejected, 1);
  assert.equal(rows[0]!.rate, 0.5);
  assert.equal(rows[1]!.partner, 'ACME');
  assert.equal(rows[1]!.total, 3);
  assert.equal(rows[1]!.rejected, 1);
  // 1 / 3 ≈ 0.333…
  assert.ok(Math.abs(rows[1]!.rate - 1 / 3) < 1e-9);
});

test('window filtering excludes 997s outside [from, to]', async () => {
  const prisma = makePrisma([
    ack({
      senderId: 'ACME', receiverId: 'US', ingestedAt: '2026-05-15T10:00:00Z',
      entries: [{ setId: '850', control: '1', status: 'R' }],
    }),
    ack({
      senderId: 'ACME', receiverId: 'US', ingestedAt: '2026-06-15T10:00:00Z',
      entries: [{ setId: '850', control: '2', status: 'A' }],
    }),
  ]);
  const rows = await getRejectionRate(prisma, {
    from: new Date('2026-06-01T00:00:00Z'),
    to: new Date('2026-07-01T00:00:00Z'),
    ourIsaIds: ['US'],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.partner, 'ACME');
  assert.equal(rows[0]!.total, 1);
  assert.equal(rows[0]!.rejected, 0);
  assert.equal(rows[0]!.rate, 0);
});

test('partner filter returns only the requested partner', async () => {
  const prisma = makePrisma([
    ack({
      senderId: 'ACME', receiverId: 'US', ingestedAt: '2026-06-01T10:00:00Z',
      entries: [{ setId: '850', control: '1', status: 'R' }],
    }),
    ack({
      senderId: 'GLOBEX', receiverId: 'US', ingestedAt: '2026-06-02T10:00:00Z',
      entries: [{ setId: '855', control: '1', status: 'A' }],
    }),
  ]);
  const rows = await getRejectionRate(prisma, {
    from: new Date('2026-05-01T00:00:00Z'),
    to: new Date('2026-07-01T00:00:00Z'),
    ourIsaIds: ['US'],
    partner: 'ACME',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.partner, 'ACME');
});

test('partner derivation: side not in OUR_ISA_IDS wins; both-or-neither = "unknown"', async () => {
  const prisma = makePrisma([
    // We sent the 997 (outbound) — partner is the receiver.
    ack({
      senderId: 'US', receiverId: 'ACME', ingestedAt: '2026-06-01T10:00:00Z',
      entries: [{ setId: '850', control: '1', status: 'A' }],
    }),
    // Neither is us — partner = "unknown".
    ack({
      senderId: 'PARTNER_A', receiverId: 'PARTNER_B', ingestedAt: '2026-06-02T10:00:00Z',
      entries: [{ setId: '850', control: '2', status: 'R' }],
    }),
  ]);
  const rows = await getRejectionRate(prisma, {
    from: new Date('2026-05-01T00:00:00Z'),
    to: new Date('2026-07-01T00:00:00Z'),
    ourIsaIds: ['US'],
  });
  const partners = rows.map((r) => r.partner).sort();
  assert.deepEqual(partners, ['ACME', 'unknown']);
});

test('no OUR_ISA_IDS configured falls back to the senderId', async () => {
  const prisma = makePrisma([
    ack({
      senderId: 'ACME', receiverId: 'US', ingestedAt: '2026-06-01T10:00:00Z',
      entries: [{ setId: '850', control: '1', status: 'A' }],
    }),
  ]);
  const rows = await getRejectionRate(prisma, {
    from: new Date('2026-05-01T00:00:00Z'),
    to: new Date('2026-07-01T00:00:00Z'),
    ourIsaIds: [],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.partner, 'ACME');
});

test('empty result set returns an empty rows array (not null)', async () => {
  const prisma = makePrisma([]);
  const rows = await getRejectionRate(prisma, {
    from: new Date('2026-05-01T00:00:00Z'),
    to: new Date('2026-07-01T00:00:00Z'),
    ourIsaIds: ['US'],
  });
  assert.equal(rows.length, 0);
  assert.ok(Array.isArray(rows));
});
