/**
 * Phase 8 Sprint 1 — confirmedAt propagation tests.
 *
 * Exercises `backfillConfirmedAt` against an in-memory Prisma fake. The same
 * helper is also called inline by parseAndStore when a 997 lands; covering it
 * here keeps the contract under test without spinning up a real DB.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { backfillConfirmedAt } from '../src/services/parsing.js';

interface SeededOriginal {
  id: string;
  direction: 'inbound' | 'outbound' | 'unknown';
  transactionSetId: string;
  controlNumber: string;
  groupControl: string;
  confirmedAt: Date | null;
}

interface SeededAck {
  id: string;
  ackedGroupControl: string;
  ackedTxnControls: Array<{ setId: string; control: string; status: string }>;
  ingestedAt: Date;
}

/** Build a PrismaClient-shaped fake whose transaction.findMany returns the
 *  seeded acks (shaped like the propagator expects) and whose updateMany
 *  applies the confirmedAt: null guard against the seeded originals. */
function makeFakePrisma(originals: SeededOriginal[], acks: SeededAck[]): PrismaClient {
  const findMany = async (): Promise<unknown[]> =>
    acks.map((a) => ({
      id: a.id,
      ackedGroupControl: a.ackedGroupControl,
      ackedTxnControls: a.ackedTxnControls,
      functionalGroup: { interchange: { rawFile: { ingestedAt: a.ingestedAt } } },
    }));

  type UpdateManyArgs = {
    where: {
      direction?: string;
      confirmedAt?: null;
      functionalGroup?: { controlNumber?: string };
      OR?: Array<{ transactionSetId?: string; controlNumber?: string }>;
    };
    data: { confirmedAt?: Date };
  };
  const updateMany = async (args: UpdateManyArgs): Promise<{ count: number }> => {
    const { where, data } = args;
    let count = 0;
    for (const o of originals) {
      if (where.direction && o.direction !== where.direction) continue;
      if (where.confirmedAt === null && o.confirmedAt !== null) continue;
      if (where.functionalGroup?.controlNumber && o.groupControl !== where.functionalGroup.controlNumber) continue;
      if (where.OR && !where.OR.some(
        (e) => e.transactionSetId === o.transactionSetId && e.controlNumber === o.controlNumber,
      )) continue;
      o.confirmedAt = data.confirmedAt ?? null;
      count += 1;
    }
    return { count };
  };

  return {
    transaction: { findMany, updateMany },
  } as unknown as PrismaClient;
}

test('backfillConfirmedAt sets confirmedAt = ack.ingestedAt on the matched outbound original', async () => {
  const ackedAt = new Date('2026-06-19T14:00:00.000Z');
  const originals: SeededOriginal[] = [
    {
      id: 'orig-1', direction: 'outbound', transactionSetId: '850',
      controlNumber: '0001', groupControl: 'GS-100', confirmedAt: null,
    },
  ];
  const acks: SeededAck[] = [
    {
      id: 'ack-1', ackedGroupControl: 'GS-100',
      ackedTxnControls: [{ setId: '850', control: '0001', status: 'A' }],
      ingestedAt: ackedAt,
    },
  ];
  const updated = await backfillConfirmedAt(makeFakePrisma(originals, acks));
  assert.equal(updated, 1);
  assert.equal(originals[0]!.confirmedAt?.toISOString(), ackedAt.toISOString());
});

test('backfillConfirmedAt skips inbound originals even if the (set, control) matches', async () => {
  const originals: SeededOriginal[] = [
    {
      id: 'orig-in', direction: 'inbound', transactionSetId: '850',
      controlNumber: '0001', groupControl: 'GS-100', confirmedAt: null,
    },
  ];
  const acks: SeededAck[] = [
    {
      id: 'ack-1', ackedGroupControl: 'GS-100',
      ackedTxnControls: [{ setId: '850', control: '0001', status: 'A' }],
      ingestedAt: new Date('2026-06-19T14:00:00.000Z'),
    },
  ];
  const updated = await backfillConfirmedAt(makeFakePrisma(originals, acks));
  assert.equal(updated, 0);
  assert.equal(originals[0]!.confirmedAt, null);
});

test('backfillConfirmedAt is idempotent — already-confirmed rows stay at the earliest ack time', async () => {
  const earlier = new Date('2026-06-19T10:00:00.000Z');
  const later = new Date('2026-06-19T14:00:00.000Z');
  const originals: SeededOriginal[] = [
    {
      id: 'orig-1', direction: 'outbound', transactionSetId: '850',
      controlNumber: '0001', groupControl: 'GS-100', confirmedAt: earlier,
    },
  ];
  const acks: SeededAck[] = [
    {
      id: 'ack-late', ackedGroupControl: 'GS-100',
      ackedTxnControls: [{ setId: '850', control: '0001', status: 'A' }],
      ingestedAt: later,
    },
  ];
  const updated = await backfillConfirmedAt(makeFakePrisma(originals, acks));
  assert.equal(updated, 0, 'guard skipped the row');
  assert.equal(originals[0]!.confirmedAt?.toISOString(), earlier.toISOString());
});

test('backfillConfirmedAt one ack with multiple acked txns updates each matching outbound', async () => {
  const ackedAt = new Date('2026-06-19T14:00:00.000Z');
  const originals: SeededOriginal[] = [
    { id: 'a', direction: 'outbound', transactionSetId: '850', controlNumber: '0001', groupControl: 'GS-100', confirmedAt: null },
    { id: 'b', direction: 'outbound', transactionSetId: '850', controlNumber: '0002', groupControl: 'GS-100', confirmedAt: null },
    // Same set+control but different group → must NOT be matched.
    { id: 'c', direction: 'outbound', transactionSetId: '850', controlNumber: '0001', groupControl: 'GS-OTHER', confirmedAt: null },
  ];
  const acks: SeededAck[] = [
    {
      id: 'ack-1', ackedGroupControl: 'GS-100',
      ackedTxnControls: [
        { setId: '850', control: '0001', status: 'A' },
        { setId: '850', control: '0002', status: 'R' },
      ],
      ingestedAt: ackedAt,
    },
  ];
  const updated = await backfillConfirmedAt(makeFakePrisma(originals, acks));
  assert.equal(updated, 2);
  assert.equal(originals[0]!.confirmedAt?.toISOString(), ackedAt.toISOString());
  assert.equal(originals[1]!.confirmedAt?.toISOString(), ackedAt.toISOString());
  assert.equal(originals[2]!.confirmedAt, null, 'different group control was not touched');
});

test('backfillConfirmedAt ignores acks with malformed ackedTxnControls', async () => {
  const originals: SeededOriginal[] = [
    { id: 'a', direction: 'outbound', transactionSetId: '850', controlNumber: '0001', groupControl: 'GS-100', confirmedAt: null },
  ];
  const acks: SeededAck[] = [
    {
      id: 'broken', ackedGroupControl: 'GS-100',
      // Not a typed entry — propagator's parser drops it.
      ackedTxnControls: [{ setId: '', control: '', status: '' }],
      ingestedAt: new Date('2026-06-19T14:00:00.000Z'),
    },
  ];
  const updated = await backfillConfirmedAt(makeFakePrisma(originals, acks));
  assert.equal(updated, 0);
  assert.equal(originals[0]!.confirmedAt, null);
});
