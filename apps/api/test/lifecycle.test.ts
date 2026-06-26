/**
 * Lifecycle stitching tests — Phase 4 Sprint 2's North Star.
 *
 * Exercises `getLifecycle` against an in-memory Prisma fake holding pre-shaped
 * transaction rows (as they would exist after parseAndStore). Covers spine
 * resolution by PO/invoice/shipment, ack linkage (single + multi-ack +
 * reject), chronological ordering, both seed flows (standard + grocery),
 * gap detection, and not-found.
 *
 * Route-level coverage (validation, 400/404/200 contract) lives in the route
 * test pattern used by the rest of the API — this file is intentionally
 * scoped to the service so it runs as fast sync logic with no Fastify boot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { getLifecycle } from '../src/services/lifecycle.js';

type Dir = 'inbound' | 'outbound' | 'unknown';

interface FakeTxn {
  id: string;
  transactionSetId: string;
  controlNumber: string;
  poNumber: string | null;
  invoiceNumber: string | null;
  shipmentId: string | null;
  ackedGroupControl: string | null;
  ackedTxnControls: unknown;
  ackStatus: string | null;
  direction: Dir;
  // Phase 8 Sprint 1 — outbound lifecycle timestamps. Default null so older
  // fixtures keep their pre-Phase-8 semantics (stage derives to null).
  generatedAt: Date | null;
  transmittedAt: Date | null;
  confirmedAt: Date | null;
  functionalGroup: {
    controlNumber: string;
    interchange: {
      senderId: string;
      receiverId: string;
      rawFile: { id: string; ingestedAt: Date };
    };
  };
}

function tx(o: Partial<FakeTxn> & { id: string; transactionSetId: string; controlNumber: string; groupControl: string; ingestedAt: string }): FakeTxn {
  return {
    id: o.id,
    transactionSetId: o.transactionSetId,
    controlNumber: o.controlNumber,
    poNumber: o.poNumber ?? null,
    invoiceNumber: o.invoiceNumber ?? null,
    shipmentId: o.shipmentId ?? null,
    ackedGroupControl: o.ackedGroupControl ?? null,
    ackedTxnControls: o.ackedTxnControls ?? null,
    ackStatus: o.ackStatus ?? null,
    direction: o.direction ?? 'unknown',
    generatedAt: o.generatedAt ?? null,
    transmittedAt: o.transmittedAt ?? null,
    confirmedAt: o.confirmedAt ?? null,
    functionalGroup: {
      controlNumber: o.groupControl,
      interchange: {
        senderId: 'SENDER',
        receiverId: 'RECEIVER',
        rawFile: { id: `raw-${o.id}`, ingestedAt: new Date(o.ingestedAt) },
      },
    },
  };
}

/** Predicate: does a string field match the where clause, including the
 *  Prisma "{ not: null }" pattern used by findFirst guards? */
function fieldMatches(value: string | null, clause: unknown): boolean {
  if (clause === undefined) return true;
  if (clause === null) return value === null;
  if (typeof clause === 'string') return value === clause;
  if (clause && typeof clause === 'object') {
    const c = clause as { not?: unknown; in?: string[] };
    if ('not' in c) {
      if (c.not === null) return value !== null;
      return value !== c.not;
    }
    if (Array.isArray(c.in)) return value !== null && c.in.includes(value);
  }
  return false;
}

function partnerPairMatches(
  senderId: string,
  receiverId: string,
  clause: unknown,
): boolean {
  if (!clause || typeof clause !== 'object') return true;
  const or = (clause as { OR?: Array<{ senderId?: string; receiverId?: string }> }).OR;
  if (!Array.isArray(or)) return true;
  return or.some((pair) => pair.senderId === senderId && pair.receiverId === receiverId);
}

function matches(t: FakeTxn, where: Record<string, unknown>): boolean {
  if (where.id && typeof where.id === 'object') {
    const notIn = (where.id as { notIn?: string[] }).notIn;
    if (Array.isArray(notIn) && notIn.includes(t.id)) return false;
  }
  if (!fieldMatches(t.poNumber, where.poNumber)) return false;
  if (!fieldMatches(t.invoiceNumber, where.invoiceNumber)) return false;
  if (!fieldMatches(t.shipmentId, where.shipmentId)) return false;
  if (!fieldMatches(t.transactionSetId, where.transactionSetId)) return false;
  if (!fieldMatches(t.ackedGroupControl, where.ackedGroupControl)) return false;
  const fg = where.functionalGroup as { interchange?: { OR?: unknown } } | undefined;
  if (fg?.interchange) {
    const ic = t.functionalGroup.interchange;
    if (!partnerPairMatches(ic.senderId, ic.receiverId, fg.interchange)) return false;
  }
  return true;
}

interface PartnerSeed {
  supportedSets?: string[];
  lifecycleFlows?: Array<{ name: string; entrySetId: string; steps: Array<{ setId: string; direction: Dir }> }>;
  ackCodeOverrides?: Record<string, Record<string, string>>;
  // Phase 8 Sprint 3 — connectivity surfaces as partnerChannel on outbound rows.
  connectivity?: { channel: 'AS2' | 'SFTP' | 'VAN' | 'API' | 'EMAIL'; endpoint: string; technicalContact: string; notes?: string };
}

function makePrisma(txns: FakeTxn[], partner?: PartnerSeed): PrismaClient {
  const self: PrismaClient = {
    transaction: {
      async findMany({ where }: { where: Record<string, unknown> }) {
        return txns.filter((t) => matches(t, where));
      },
      async findFirst({ where }: { where: Record<string, unknown> }) {
        const match = txns.find((t) => matches(t, where));
        if (!match) return null;
        return { poNumber: match.poNumber };
      },
    },
    tradingPartner: (() => {
      // Phase 6 — by default no partner is configured. When a `PartnerSeed`
      // is supplied we hand it back regardless of the where clause; the
      // resolver semantics are exercised in partners-config.test.ts.
      //
      // Desktop track D1 Sprint 3 — Option A switched resolvePartnerByIsa from
      // findFirst-with-array-operators to findMany + JS membership, so we now
      // stub both shapes against the same single-partner fixture.
      const stubRow = () => ({
        id: 'p-1', tenantId: null, displayName: 'Stub',
        // Stub claims the same 'SENDER' / 'RECEIVER' the tx() helper bakes
        // into every interchange so the Option A resolver finds a match.
        isaSenderIds: ['SENDER'], isaReceiverIds: ['RECEIVER'],
        status: 'active', notes: null, contacts: [],
        supportedSets: partner?.supportedSets ?? [],
        lifecycleFlows: partner?.lifecycleFlows ?? [],
        ackCodeOverrides: partner?.ackCodeOverrides ?? {},
        // Phase 8 Sprint 3 — connectivity round-trips through readConnectivity;
        // the {} default mirrors the schema default for unconfigured partners.
        connectivity: partner?.connectivity ?? {},
        createdAt: new Date(), updatedAt: new Date(),
      });
      return {
        async findFirst() { return partner ? stubRow() : null; },
        async findMany() { return partner ? [stubRow()] : []; },
      };
    })(),
  } as unknown as PrismaClient;
  return self;
}

// ─────────────────────────────────────────────────────────────
// Standard flow fixtures: 850 → 997 → 855 → 997 → 810 → 997.
// All share PO-100; originals live in groups 1/2/3, acks in 10/11/12.
// ─────────────────────────────────────────────────────────────

const orig850 = tx({
  id: 't-850', transactionSetId: '850', controlNumber: 'T1', groupControl: '1',
  poNumber: 'PO-100', direction: 'inbound', ingestedAt: '2026-06-01T10:00:00Z',
});
const ack850 = tx({
  id: 'ack-850', transactionSetId: '997', controlNumber: '9001', groupControl: '10',
  direction: 'outbound', ingestedAt: '2026-06-01T11:00:00Z',
  ackedGroupControl: '1', ackStatus: 'A',
  ackedTxnControls: [{ setId: '850', control: 'T1', status: 'A' }],
});
const orig855 = tx({
  id: 't-855', transactionSetId: '855', controlNumber: 'T2', groupControl: '2',
  poNumber: 'PO-100', direction: 'outbound', ingestedAt: '2026-06-02T10:00:00Z',
});
const ack855 = tx({
  id: 'ack-855', transactionSetId: '997', controlNumber: '9002', groupControl: '11',
  direction: 'inbound', ingestedAt: '2026-06-02T11:00:00Z',
  ackedGroupControl: '2', ackStatus: 'A',
  ackedTxnControls: [{ setId: '855', control: 'T2', status: 'A' }],
});
const orig810 = tx({
  id: 't-810', transactionSetId: '810', controlNumber: 'T3', groupControl: '3',
  poNumber: 'PO-100', invoiceNumber: 'INV-9001', direction: 'outbound',
  ingestedAt: '2026-06-05T10:00:00Z',
});
const ack810 = tx({
  id: 'ack-810', transactionSetId: '997', controlNumber: '9003', groupControl: '12',
  direction: 'inbound', ingestedAt: '2026-06-05T11:00:00Z',
  ackedGroupControl: '3', ackStatus: 'A',
  ackedTxnControls: [{ setId: '810', control: 'T3', status: 'A' }],
});

test('standard flow happy path: every doc present, every status correct', async () => {
  const prisma = makePrisma([orig850, ack850, orig855, ack855, orig810, ack810]);
  const r = await getLifecycle(prisma, { po: 'PO-100' });
  assert.ok(r);
  assert.equal(r!.po, 'PO-100');
  assert.equal(r!.flow, 'standard');
  assert.equal(r!.enteredBy.kind, 'po');
  const txEvents = r!.events.filter((e) => e.kind === 'transaction');
  assert.equal(txEvents.length, 6);
  const ids = txEvents.map((e) => e.transactionId);
  assert.deepEqual(ids, ['t-850', 'ack-850', 't-855', 'ack-855', 't-810', 'ack-810']);
  const t850Event = txEvents.find((e) => e.transactionId === 't-850')!;
  assert.equal(t850Event.status, 'acknowledged');
  assert.equal(t850Event.ackedByTransactionId, 'ack-850');
  assert.equal(r!.events.filter((e) => e.kind === 'gap').length, 0);
});

test('missing 997 surfaces as a gap, not an error', async () => {
  const prisma = makePrisma([orig850, orig855]);
  const r = await getLifecycle(prisma, { po: 'PO-100' });
  assert.ok(r);
  assert.equal(r!.flow, 'standard');
  const gaps = r!.events.filter((e) => e.kind === 'gap');
  const setIds = gaps.map((g) => g.transactionSetId).sort();
  assert.deepEqual(setIds, ['810', '997', '997', '997']);
  assert.ok(gaps.every((g) => g.status === 'expected_missing'));
  assert.equal(r!.events.find((e) => e.transactionId === 't-850')!.status, 'received');
});

test('rejected ack flips the original to rejected', async () => {
  const rejectingAck = tx({
    id: 'ack-r', transactionSetId: '997', controlNumber: '9099', groupControl: '99',
    direction: 'outbound', ingestedAt: '2026-06-01T11:00:00Z',
    ackedGroupControl: '1', ackStatus: 'R',
    ackedTxnControls: [{ setId: '850', control: 'T1', status: 'R' }],
  });
  const prisma = makePrisma([orig850, rejectingAck]);
  const r = await getLifecycle(prisma, { po: 'PO-100' });
  assert.ok(r);
  const t850Event = r!.events.find((e) => e.transactionId === 't-850')!;
  assert.equal(t850Event.status, 'rejected');
  const ackEvent = r!.events.find((e) => e.transactionId === 'ack-r')!;
  assert.equal(ackEvent.status, 'rejected');
  assert.equal(ackEvent.ackStatus, 'R');
});

test('one 997 acking two transactions links to both', async () => {
  const multiAck = tx({
    id: 'ack-multi', transactionSetId: '997', controlNumber: '9100', groupControl: '20',
    direction: 'outbound', ingestedAt: '2026-06-03T11:00:00Z',
    ackedGroupControl: '1', ackStatus: 'A',
    ackedTxnControls: [
      { setId: '850', control: 'T1', status: 'A' },
      { setId: '850', control: 'T1B', status: 'R' },
    ],
  });
  const sibling850 = tx({
    id: 't-850b', transactionSetId: '850', controlNumber: 'T1B', groupControl: '1',
    poNumber: 'PO-100', direction: 'inbound', ingestedAt: '2026-06-01T10:05:00Z',
  });
  const prisma = makePrisma([orig850, sibling850, multiAck]);
  const r = await getLifecycle(prisma, { po: 'PO-100' });
  assert.ok(r);
  const t1 = r!.events.find((e) => e.transactionId === 't-850')!;
  const t2 = r!.events.find((e) => e.transactionId === 't-850b')!;
  assert.equal(t1.status, 'acknowledged');
  assert.equal(t1.ackedByTransactionId, 'ack-multi');
  assert.equal(t2.status, 'rejected');
  assert.equal(t2.ackedByTransactionId, 'ack-multi');
  assert.equal(r!.events.filter((e) => e.transactionId === 'ack-multi').length, 1);
});

test('out-of-order ingestion still produces chronological output', async () => {
  const prisma = makePrisma([ack810, orig850, orig810, ack850, ack855, orig855]);
  const r = await getLifecycle(prisma, { po: 'PO-100' });
  assert.ok(r);
  const ids = r!.events.filter((e) => e.kind === 'transaction').map((e) => e.transactionId);
  assert.deepEqual(ids, ['t-850', 'ack-850', 't-855', 'ack-855', 't-810', 'ack-810']);
});

test('invoice entry point resolves to the PO spine', async () => {
  const prisma = makePrisma([orig850, orig810]);
  const r = await getLifecycle(prisma, { invoice: 'INV-9001' });
  assert.ok(r);
  assert.equal(r!.po, 'PO-100');
  assert.equal(r!.enteredBy.kind, 'invoice');
  assert.equal(r!.enteredBy.value, 'INV-9001');
});

test('shipment entry point resolves to the PO spine', async () => {
  const ship = tx({
    id: 't-856', transactionSetId: '856', controlNumber: 'T4', groupControl: '4',
    poNumber: 'PO-100', shipmentId: 'SHIP-XYZ', direction: 'outbound',
    ingestedAt: '2026-06-04T10:00:00Z',
  });
  const prisma = makePrisma([orig850, ship]);
  const r = await getLifecycle(prisma, { shipment: 'SHIP-XYZ' });
  assert.ok(r);
  assert.equal(r!.po, 'PO-100');
  assert.equal(r!.enteredBy.kind, 'shipment');
});

test('grocery flow: 875 + 880 chooses grocery seed, no standard gaps', async () => {
  const g875 = tx({
    id: 't-875', transactionSetId: '875', controlNumber: 'G1', groupControl: '101',
    poNumber: 'PO-G', direction: 'inbound', ingestedAt: '2026-06-10T10:00:00Z',
  });
  const g880 = tx({
    id: 't-880', transactionSetId: '880', controlNumber: 'G2', groupControl: '102',
    poNumber: 'PO-G', invoiceNumber: 'GINV-1', direction: 'outbound',
    ingestedAt: '2026-06-12T10:00:00Z',
  });
  const prisma = makePrisma([g875, g880]);
  const r = await getLifecycle(prisma, { po: 'PO-G' });
  assert.ok(r);
  assert.equal(r!.flow, 'grocery');
  assert.equal(r!.events.filter((e) => e.kind === 'gap').length, 0);
  assert.equal(r!.events.filter((e) => e.transactionSetId === '850').length, 0);
});

test('no-match returns null', async () => {
  const prisma = makePrisma([orig850]);
  const r = await getLifecycle(prisma, { po: 'PO-NOPE' });
  assert.equal(r, null);
});

test('invoice with no matching transaction returns null', async () => {
  const prisma = makePrisma([orig850]);
  const r = await getLifecycle(prisma, { invoice: 'INV-NOPE' });
  assert.equal(r, null);
});

// ─────────────────────────────────────────────────────────────
// Phase 5 — rejection summary + details flow into the events
// ─────────────────────────────────────────────────────────────

test('rejected original carries rejectionSummary + rejectionDetails copied from the 997', async () => {
  // 997 with structured AK3/AK4 errors for the 850 it acks.
  const structuredAck = tx({
    id: 'ack-struct', transactionSetId: '997', controlNumber: '9201', groupControl: '50',
    direction: 'outbound', ingestedAt: '2026-06-01T11:00:00Z',
    ackedGroupControl: '1', ackStatus: 'R',
    ackedTxnControls: [
      {
        setId: '850', control: 'T1', status: 'R',
        statusMessage: 'Rejected',
        errors: [
          {
            segmentTag: 'BEG', segmentPosition: '2', loopIdentifier: '',
            syntaxErrorCode: '8', syntaxErrorMessage: 'Segment Has Data Element Errors',
            elementErrors: [
              {
                elementPosition: '3', dataElementReference: '324',
                syntaxErrorCode: '1', syntaxErrorMessage: 'Mandatory data element missing',
                badValue: '',
              },
            ],
          },
        ],
      },
    ],
  });
  const prisma = makePrisma([orig850, structuredAck]);
  const r = await getLifecycle(prisma, { po: 'PO-100' });
  assert.ok(r);

  // The original 850 event carries the summary + the structured detail.
  const originalEvt = r!.events.find((e) => e.transactionId === 't-850')!;
  assert.equal(originalEvt.status, 'rejected');
  assert.equal(originalEvt.rejectionSummary, 'BEG03 — Mandatory data element missing');
  assert.ok(originalEvt.rejectionDetails);
  assert.equal(originalEvt.rejectionDetails!.length, 1);
  assert.equal(originalEvt.rejectionDetails![0]!.segmentTag, 'BEG');
  assert.equal(originalEvt.rejectionDetails![0]!.elementErrors[0]!.elementPosition, '3');

  // The 997 event itself also carries the aggregated detail.
  const ackEvt = r!.events.find((e) => e.transactionId === 'ack-struct')!;
  assert.equal(ackEvt.status, 'rejected');
  assert.equal(ackEvt.rejectionSummary, 'BEG03 — Mandatory data element missing');
  assert.ok(ackEvt.rejectionDetails);
  assert.equal(ackEvt.rejectionDetails!.length, 1);
});

test('accepted original has no rejectionSummary / rejectionDetails', async () => {
  const prisma = makePrisma([orig850, ack850, orig855, ack855, orig810, ack810]);
  const r = await getLifecycle(prisma, { po: 'PO-100' });
  assert.ok(r);
  const t850Evt = r!.events.find((e) => e.transactionId === 't-850')!;
  assert.equal(t850Evt.status, 'acknowledged');
  assert.equal(t850Evt.rejectionSummary, null);
  assert.equal(t850Evt.rejectionDetails, null);
});

test('gap events have null rejection fields', async () => {
  const prisma = makePrisma([orig850]); // no acks → many gaps
  const r = await getLifecycle(prisma, { po: 'PO-100' });
  assert.ok(r);
  const gaps = r!.events.filter((e) => e.kind === 'gap');
  assert.ok(gaps.length > 0);
  for (const g of gaps) {
    assert.equal(g.rejectionSummary, null);
    assert.equal(g.rejectionDetails, null);
  }
});

// ─────────────────────────────────────────────────────────────
// Phase 6 Sprint 2 — partner-supplied lifecycle flow + ack overrides
// ─────────────────────────────────────────────────────────────

test('partner-configured flow drives gap detection instead of shipped defaults', async () => {
  // Partner's custom flow expects only 850 + outbound 997, no 855/810 at all.
  const partner: PartnerSeed = {
    lifecycleFlows: [
      {
        name: 'Sysco minimal',
        entrySetId: '850',
        steps: [
          { setId: '850', direction: 'inbound' },
          { setId: '997', direction: 'outbound' },
        ],
      },
    ],
  };
  const prisma = makePrisma([orig850, ack850], partner);
  const r = await getLifecycle(prisma, { po: 'PO-100' }, { ourIsaIds: ['RECEIVER'] });
  assert.ok(r);
  // No gaps — partner flow says only 850 + 997 is needed.
  assert.equal(r!.events.filter((e) => e.kind === 'gap').length, 0);
});

test('no partner config preserves shipped-default behavior (byte-identical)', async () => {
  const prisma = makePrisma([orig850, orig855]); // no partner
  const r = await getLifecycle(prisma, { po: 'PO-100' });
  assert.ok(r);
  // Same expectation as the Phase 4 missing-997 test: 1 out-997, 2 in-997, 1 810.
  const setIds = r!.events.filter((e) => e.kind === 'gap').map((g) => g.transactionSetId).sort();
  assert.deepEqual(setIds, ['810', '997', '997', '997']);
});

test('partner ack-code overrides replace rejection-detail messages', async () => {
  const rejectingAck = tx({
    id: 'ack-rej', transactionSetId: '997', controlNumber: '9999', groupControl: '50',
    direction: 'outbound', ingestedAt: '2026-06-01T11:00:00Z',
    ackedGroupControl: '1', ackStatus: 'R',
    ackedTxnControls: [
      {
        setId: '850', control: 'T1', status: 'R',
        statusMessage: 'Rejected',
        errors: [
          {
            segmentTag: 'BEG', segmentPosition: '2', loopIdentifier: '',
            syntaxErrorCode: '8', syntaxErrorMessage: 'Segment Has Data Element Errors',
            elementErrors: [
              {
                elementPosition: '3', dataElementReference: '324',
                syntaxErrorCode: '1', syntaxErrorMessage: 'Mandatory data element missing',
                badValue: '',
              },
            ],
          },
        ],
      },
    ],
  });
  const partner: PartnerSeed = {
    ackCodeOverrides: { AK403: { '1': 'Sysco rule SVS-12 — required field missing' } },
  };
  const prisma = makePrisma([orig850, rejectingAck], partner);
  const r = await getLifecycle(prisma, { po: 'PO-100' }, { ourIsaIds: ['RECEIVER'] });
  assert.ok(r);
  const t850 = r!.events.find((e) => e.transactionId === 't-850')!;
  assert.equal(t850.rejectionDetails![0]!.elementErrors[0]!.syntaxErrorMessage, 'Sysco rule SVS-12 — required field missing');
});

// ─────────────────────────────────────────────────────────────
// Phase 8 Sprint 1 — outboundStage derivation in lifecycle events
// ─────────────────────────────────────────────────────────────

test('outbound 810 with all three timestamps renders as confirmed', async () => {
  const outOrig810 = tx({
    id: 't-810c', transactionSetId: '810', controlNumber: 'T1', groupControl: '1',
    poNumber: 'PO-CONF', direction: 'outbound', ingestedAt: '2026-06-10T10:00:00Z',
    generatedAt: new Date('2026-06-10T10:00:00Z'),
    transmittedAt: new Date('2026-06-10T10:00:00Z'),
    confirmedAt: new Date('2026-06-10T11:00:00Z'),
  });
  const prisma = makePrisma([outOrig810]);
  const r = await getLifecycle(prisma, { po: 'PO-CONF' });
  assert.ok(r);
  const ev = r!.events.find((e) => e.transactionId === 't-810c')!;
  assert.equal(ev.outboundStage, 'confirmed');
});

test('outbound 810 with only generated + transmitted renders as transmitted', async () => {
  const outOrig810 = tx({
    id: 't-810t', transactionSetId: '810', controlNumber: 'T1', groupControl: '1',
    poNumber: 'PO-TRANS', direction: 'outbound', ingestedAt: '2026-06-10T10:00:00Z',
    generatedAt: new Date('2026-06-10T10:00:00Z'),
    transmittedAt: new Date('2026-06-10T10:00:00Z'),
    confirmedAt: null,
  });
  const prisma = makePrisma([outOrig810]);
  const r = await getLifecycle(prisma, { po: 'PO-TRANS' });
  assert.ok(r);
  const ev = r!.events.find((e) => e.transactionId === 't-810t')!;
  assert.equal(ev.outboundStage, 'transmitted');
});

test('inbound transaction has outboundStage null', async () => {
  const inbound850 = tx({
    id: 't-in', transactionSetId: '850', controlNumber: 'T1', groupControl: '1',
    poNumber: 'PO-IN', direction: 'inbound', ingestedAt: '2026-06-10T10:00:00Z',
    // All three null by default on inbound.
  });
  const prisma = makePrisma([inbound850]);
  const r = await getLifecycle(prisma, { po: 'PO-IN' });
  assert.ok(r);
  const ev = r!.events.find((e) => e.transactionId === 't-in')!;
  assert.equal(ev.outboundStage, null);
});

test('gap events carry outboundStage null', async () => {
  const inbound850 = tx({
    id: 't-gap', transactionSetId: '850', controlNumber: 'T1', groupControl: '1',
    poNumber: 'PO-GAP', direction: 'inbound', ingestedAt: '2026-06-10T10:00:00Z',
  });
  const prisma = makePrisma([inbound850]);
  const r = await getLifecycle(prisma, { po: 'PO-GAP' });
  assert.ok(r);
  const gaps = r!.events.filter((e) => e.kind === 'gap');
  assert.ok(gaps.length > 0, 'standard flow with only an 850 should produce gaps');
  assert.ok(gaps.every((g) => g.outboundStage === null));
});

// ─────────────────────────────────────────────────────────────
// Phase 8 Sprint 3 — partnerChannel surfaces on outbound rows
// ─────────────────────────────────────────────────────────────

test('outbound events carry the partner connectivity channel; inbound + gap stay null', async () => {
  // Pair: one outbound 810, one inbound 850 — same PO. The 810 should pick up
  // the channel; the 850 (inbound) and any gaps should not.
  const out810 = tx({
    id: 't-out', transactionSetId: '810', controlNumber: 'T1', groupControl: '1',
    poNumber: 'PO-CH', invoiceNumber: 'INV-1', direction: 'outbound',
    ingestedAt: '2026-06-10T11:00:00Z',
  });
  const in850 = tx({
    id: 't-in', transactionSetId: '850', controlNumber: 'T2', groupControl: '2',
    poNumber: 'PO-CH', direction: 'inbound',
    ingestedAt: '2026-06-10T10:00:00Z',
  });
  const partner: PartnerSeed = {
    connectivity: {
      channel: 'AS2',
      endpoint: 'https://partner.example.com/as2',
      technicalContact: 'ops@partner.example.com',
    },
  };
  const prisma = makePrisma([in850, out810], partner);
  const r = await getLifecycle(prisma, { po: 'PO-CH' }, { ourIsaIds: ['RECEIVER'] });
  assert.ok(r);
  const outEv = r!.events.find((e) => e.transactionId === 't-out')!;
  const inEv = r!.events.find((e) => e.transactionId === 't-in')!;
  assert.equal(outEv.partnerChannel, 'AS2');
  assert.equal(inEv.partnerChannel, null);
  const gaps = r!.events.filter((e) => e.kind === 'gap');
  assert.ok(gaps.every((g) => g.partnerChannel === null));
});

test('partnerChannel is null when the partner has no connectivity configured', async () => {
  const out810 = tx({
    id: 't-out2', transactionSetId: '810', controlNumber: 'T1', groupControl: '1',
    poNumber: 'PO-NOCX', invoiceNumber: 'INV-2', direction: 'outbound',
    ingestedAt: '2026-06-10T11:00:00Z',
  });
  // Partner exists but no connectivity block.
  const prisma = makePrisma([out810], {});
  const r = await getLifecycle(prisma, { po: 'PO-NOCX' }, { ourIsaIds: ['RECEIVER'] });
  assert.ok(r);
  const ev = r!.events.find((e) => e.transactionId === 't-out2')!;
  assert.equal(ev.partnerChannel, null);
});

// ─────────────────────────────────────────────────────────────
// US Foods synthetic lifecycle + orphan PO stitching
// ─────────────────────────────────────────────────────────────

test('US Foods group-1: 850 + 855 + 810 on same PO produce no 855/810 gaps', async () => {
  const us850 = tx({
    id: 'uf-850', transactionSetId: '850', controlNumber: '9901', groupControl: '9901',
    poNumber: '7599901Q', direction: 'inbound', ingestedAt: '2026-07-01T10:00:00Z',
  });
  us850.functionalGroup.interchange.senderId = '621418185';
  us850.functionalGroup.interchange.receiverId = '7085892400';
  const us855 = tx({
    id: 'uf-855', transactionSetId: '855', controlNumber: '0001', groupControl: '9902',
    poNumber: '7599901Q', direction: 'outbound', ingestedAt: '2026-07-02T10:00:00Z',
  });
  us855.functionalGroup.interchange.senderId = '7085892400';
  us855.functionalGroup.interchange.receiverId = '621418185';
  const us810 = tx({
    id: 'uf-810', transactionSetId: '810', controlNumber: '0007', groupControl: '9903',
    poNumber: '7599901Q', invoiceNumber: '5199901', direction: 'outbound',
    ingestedAt: '2026-07-10T10:00:00Z',
  });
  us810.functionalGroup.interchange.senderId = '7085892400';
  us810.functionalGroup.interchange.receiverId = '621418185';

  const prisma = makePrisma([us850, us855, us810]);
  const r = await getLifecycle(prisma, { po: '7599901Q' }, { ourIsaIds: ['7085892400'] });
  assert.ok(r);
  assert.equal(r!.flow, 'standard');
  const txEvents = r!.events.filter((e) => e.kind === 'transaction');
  assert.deepEqual(
    txEvents.map((e) => e.transactionSetId),
    ['850', '855', '810'],
  );
  const gapSets = r!.events.filter((e) => e.kind === 'gap').map((g) => g.transactionSetId).sort();
  assert.deepEqual(gapSets, ['997', '997', '997']);
});

test('re-derives direction from interchange when stored direction is unknown', async () => {
  const us850 = tx({
    id: 'uf-850', transactionSetId: '850', controlNumber: '9901', groupControl: '9901',
    poNumber: '7599901Q', direction: 'unknown', ingestedAt: '2026-07-01T10:00:00Z',
  });
  us850.functionalGroup.interchange.senderId = '621418185';
  us850.functionalGroup.interchange.receiverId = '7085892400';
  const us855 = tx({
    id: 'uf-855', transactionSetId: '855', controlNumber: '0001', groupControl: '9902',
    poNumber: '7599901Q', direction: 'unknown', ingestedAt: '2026-07-02T10:00:00Z',
  });
  us855.functionalGroup.interchange.senderId = '7085892400';
  us855.functionalGroup.interchange.receiverId = '621418185';

  const prisma = makePrisma([us850, us855]);
  const r = await getLifecycle(prisma, { po: '7599901Q' }, { ourIsaIds: ['7085892400'] });
  assert.ok(r);
  const dirs = r!.events
    .filter((e) => e.kind === 'transaction')
    .map((e) => `${e.transactionSetId}:${e.direction}`);
  assert.deepEqual(dirs, ['850:inbound', '855:outbound']);
});

interface FakeTxnWithSegments extends FakeTxn {
  segments?: Array<{
    tag: string;
    position: number;
    elements: Array<{ index: number; value: string }>;
  }>;
}

function makePrismaWithSegments(txns: FakeTxnWithSegments[], partner?: PartnerSeed): PrismaClient {
  const base = makePrisma(txns, partner) as unknown as {
    transaction: {
      findMany: (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => Promise<unknown[]>;
      findFirst: (args: { where: Record<string, unknown> }) => Promise<unknown | null>;
    };
  };
  const origFindMany = base.transaction.findMany.bind(base.transaction);
  base.transaction.findMany = async ({ where, include }) => {
    const rows = (await origFindMany({ where })) as FakeTxnWithSegments[];
    if (include && 'segments' in include) {
      return rows.map((r) => ({ ...r, segments: r.segments ?? [] }));
    }
    return rows;
  };
  return base as unknown as PrismaClient;
}

test('orphan stitch: 855/810 with null po_number but matching BAK/BIG still appear', async () => {
  const us850 = tx({
    id: 'uf-850', transactionSetId: '850', controlNumber: '9901', groupControl: '9901',
    poNumber: '7599901Q', direction: 'inbound', ingestedAt: '2026-07-01T10:00:00Z',
  });
  us850.functionalGroup.interchange.senderId = '621418185';
  us850.functionalGroup.interchange.receiverId = '7085892400';

  const orphan855: FakeTxnWithSegments = {
    ...tx({
      id: 'uf-855', transactionSetId: '855', controlNumber: '0001', groupControl: '9902',
      poNumber: null, direction: 'outbound', ingestedAt: '2026-07-02T10:00:00Z',
    }),
    segments: [
      { tag: 'BAK', position: 1, elements: [{ index: 1, value: '00' }, { index: 2, value: 'AP' }, { index: 3, value: '7599901Q' }] },
    ],
  };
  orphan855.functionalGroup.interchange.senderId = '7085892400';
  orphan855.functionalGroup.interchange.receiverId = '621418185';

  const orphan810: FakeTxnWithSegments = {
    ...tx({
      id: 'uf-810', transactionSetId: '810', controlNumber: '0007', groupControl: '9903',
      poNumber: null, invoiceNumber: '5199901', direction: 'outbound',
      ingestedAt: '2026-07-10T10:00:00Z',
    }),
    segments: [
      {
        tag: 'BIG', position: 1,
        elements: [
          { index: 1, value: '20260709' }, { index: 2, value: '5199901' },
          { index: 3, value: '20260701' }, { index: 4, value: '7599901Q' },
        ],
      },
    ],
  };
  orphan810.functionalGroup.interchange.senderId = '7085892400';
  orphan810.functionalGroup.interchange.receiverId = '621418185';

  const prisma = makePrismaWithSegments([us850, orphan855, orphan810]);
  const r = await getLifecycle(prisma, { po: '7599901Q' }, { ourIsaIds: ['7085892400'] });
  assert.ok(r);
  const txEvents = r!.events.filter((e) => e.kind === 'transaction');
  assert.deepEqual(
    txEvents.map((e) => e.transactionSetId),
    ['850', '855', '810'],
  );
  assert.equal(r!.events.filter((e) => e.kind === 'gap' && e.transactionSetId === '855').length, 0);
  assert.equal(r!.events.filter((e) => e.kind === 'gap' && e.transactionSetId === '810').length, 0);
});
