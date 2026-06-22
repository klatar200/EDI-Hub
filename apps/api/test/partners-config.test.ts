/**
 * Phase 6 Sprint 1 — Trading partner CRUD + identifier resolver tests.
 *
 * Exercises the service layer against a small in-memory Prisma fake that
 * understands the array operators (`has`, `hasSome`) used by the resolver
 * and the overlap check. Single file covers CRUD happy paths, ISA-overlap
 * rejection, validation errors, and resolver behavior.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  PartnerConflictError,
  PartnerValidationError,
  assertNoIsaOverlap,
  getPartner,
  listPartners,
  resolvePartnerByIsa,
  validatePartnerInput,
} from '../src/services/partners.js';
import type { PartnerConfigInput } from '@edi/shared';

interface FakeRow {
  id: string;
  tenantId: string | null;
  displayName: string;
  isaSenderIds: string[];
  isaReceiverIds: string[];
  status: 'active' | 'disabled';
  notes: string | null;
  contacts: unknown;
  /** Phase 8 Sprint 3 — connectivity JSONB; default {} for unconfigured. */
  connectivity: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface Store {
  rows: FakeRow[];
  seq: number;
}

function makePrisma(store: Store): PrismaClient {
  function matches(row: FakeRow, where: Record<string, unknown>): boolean {
    if (where.id !== undefined) {
      const id = where.id as string | { not?: string; equals?: string };
      if (typeof id === 'string' && row.id !== id) return false;
      if (typeof id === 'object') {
        if (id.not !== undefined && row.id === id.not) return false;
        if (id.equals !== undefined && row.id !== id.equals) return false;
      }
    }
    if (where.OR) {
      const ors = where.OR as Array<Record<string, unknown>>;
      const any = ors.some((or) => matches(row, or));
      if (!any) return false;
    }
    const sender = (where.isaSenderIds as { has?: string; hasSome?: string[] } | undefined) ?? undefined;
    if (sender?.has !== undefined && !row.isaSenderIds.includes(sender.has)) return false;
    if (sender?.hasSome && !sender.hasSome.some((s) => row.isaSenderIds.includes(s))) return false;
    const receiver = (where.isaReceiverIds as { has?: string; hasSome?: string[] } | undefined) ?? undefined;
    if (receiver?.has !== undefined && !row.isaReceiverIds.includes(receiver.has)) return false;
    if (receiver?.hasSome && !receiver.hasSome.some((s) => row.isaReceiverIds.includes(s))) return false;
    return true;
  }
  const self: PrismaClient = {
    tradingPartner: {
      async findMany({ where }: { where?: Record<string, unknown> } = {}) {
        if (!where) return [...store.rows];
        return store.rows.filter((r) => matches(r, where));
      },
      async findFirst({ where }: { where?: Record<string, unknown> } = {}) {
        if (!where) return store.rows[0] ?? null;
        return store.rows.find((r) => matches(r, where)) ?? null;
      },
      async findUnique({ where }: { where: { id: string } }) {
        return store.rows.find((r) => r.id === where.id) ?? null;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const now = new Date();
        const row: FakeRow = {
          id: `p-${(store.seq += 1)}`,
          tenantId: (data.tenantId as string | null | undefined) ?? null,
          displayName: data.displayName as string,
          isaSenderIds: (data.isaSenderIds as string[] | undefined) ?? [],
          isaReceiverIds: (data.isaReceiverIds as string[] | undefined) ?? [],
          status: ((data.status as 'active' | 'disabled' | undefined) ?? 'active'),
          notes: (data.notes as string | null | undefined) ?? null,
          contacts: data.contacts ?? [],
          connectivity: data.connectivity ?? {},
          createdAt: now,
          updatedAt: now,
        };
        store.rows.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = store.rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        if (data.displayName !== undefined) row.displayName = data.displayName as string;
        if (data.isaSenderIds !== undefined) row.isaSenderIds = data.isaSenderIds as string[];
        if (data.isaReceiverIds !== undefined) row.isaReceiverIds = data.isaReceiverIds as string[];
        if (data.status !== undefined) row.status = data.status as 'active' | 'disabled';
        if (data.notes !== undefined) row.notes = data.notes as string | null;
        if (data.contacts !== undefined) row.contacts = data.contacts;
        if (data.connectivity !== undefined) row.connectivity = data.connectivity;
        row.updatedAt = new Date();
        return row;
      },
      async delete({ where }: { where: { id: string } }) {
        const idx = store.rows.findIndex((r) => r.id === where.id);
        if (idx === -1) throw new Error('not found');
        const [removed] = store.rows.splice(idx, 1);
        return removed!;
      },
    },
  } as unknown as PrismaClient;
  return self;
}

function freshStore(): { store: Store; prisma: PrismaClient } {
  const store: Store = { rows: [], seq: 0 };
  return { store, prisma: makePrisma(store) };
}

// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────

test('validatePartnerInput rejects empty display name', () => {
  assert.throws(
    () => validatePartnerInput({ displayName: '', isaSenderIds: [], isaReceiverIds: [] }),
    PartnerValidationError,
  );
});

test('validatePartnerInput rejects duplicate IDs on the same side', () => {
  assert.throws(
    () =>
      validatePartnerInput({
        displayName: 'ACME', isaSenderIds: ['X', 'X'], isaReceiverIds: [],
      }),
    PartnerValidationError,
  );
});

test('validatePartnerInput rejects blank ISA strings', () => {
  assert.throws(
    () =>
      validatePartnerInput({
        displayName: 'ACME', isaSenderIds: [' '], isaReceiverIds: [],
      }),
    PartnerValidationError,
  );
});

test('validatePartnerInput accepts a clean payload', () => {
  assert.doesNotThrow(() =>
    validatePartnerInput({
      displayName: 'ACME', isaSenderIds: ['SYSCO'], isaReceiverIds: ['US'],
    }),
  );
});

// ─────────────────────────────────────────────────────────────
// CRUD via service helpers + overlap (Gate E)
// ─────────────────────────────────────────────────────────────

async function seed(prisma: PrismaClient, input: PartnerConfigInput): Promise<string> {
  await assertNoIsaOverlap(prisma, input);
  const row = await prisma.tradingPartner.create({
    data: {
      // Phase 9 Sprint 1 — tenantId is required by the schema. The fake
      // ignores the value (it's not modeled in this test's Store) but TS
      // demands it match the Unchecked CreateInput shape.
      tenantId: '00000000-0000-0000-0000-000000000001',
      displayName: input.displayName,
      isaSenderIds: input.isaSenderIds,
      isaReceiverIds: input.isaReceiverIds,
      status: input.status ?? 'active',
      notes: input.notes ?? null,
      // Prisma's typed Json input requires a cast through unknown (same quirk
      // as parsing.ts/ackedTxnControls).
      contacts: (input.contacts ?? []) as unknown as Prisma.InputJsonValue,
    },
  });
  return (row as unknown as { id: string }).id;
}

test('listPartners returns toRecord-shaped items', async () => {
  const { prisma } = freshStore();
  await seed(prisma, { displayName: 'Sysco', isaSenderIds: ['SYSCO'], isaReceiverIds: [] });
  const items = await listPartners(prisma);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.displayName, 'Sysco');
  assert.equal(items[0]!.status, 'active');
  assert.deepEqual(items[0]!.isaSenderIds, ['SYSCO']);
  assert.equal(typeof items[0]!.createdAt, 'string'); // ISO string
});

test('getPartner returns the record or null', async () => {
  const { prisma } = freshStore();
  const id = await seed(prisma, { displayName: 'GFS', isaSenderIds: ['GFS'], isaReceiverIds: [] });
  assert.equal((await getPartner(prisma, id))!.displayName, 'GFS');
  assert.equal(await getPartner(prisma, 'nope'), null);
});

test('assertNoIsaOverlap throws when another partner already owns an ISA ID', async () => {
  const { prisma } = freshStore();
  await seed(prisma, { displayName: 'Sysco', isaSenderIds: ['SYSCO'], isaReceiverIds: [] });
  await assert.rejects(
    () =>
      assertNoIsaOverlap(prisma, {
        displayName: 'New', isaSenderIds: ['SYSCO'], isaReceiverIds: [],
      }),
    PartnerConflictError,
  );
});

test('assertNoIsaOverlap allows the same ID when updating the SAME partner', async () => {
  const { prisma } = freshStore();
  const id = await seed(prisma, { displayName: 'Sysco', isaSenderIds: ['SYSCO'], isaReceiverIds: [] });
  await assert.doesNotReject(() =>
    assertNoIsaOverlap(
      prisma,
      { displayName: 'Sysco', isaSenderIds: ['SYSCO'], isaReceiverIds: ['NEW'] },
      id,
    ),
  );
});

// ─────────────────────────────────────────────────────────────
// Resolver
// ─────────────────────────────────────────────────────────────

test('resolvePartnerByIsa matches an inbound sender (partner side) ignoring our own IDs', async () => {
  const { prisma } = freshStore();
  await seed(prisma, { displayName: 'Sysco', isaSenderIds: ['SYSCO'], isaReceiverIds: [] });
  const p = await resolvePartnerByIsa(prisma, 'SYSCO', 'US', ['US']);
  assert.ok(p);
  assert.equal(p!.displayName, 'Sysco');
});

test('resolvePartnerByIsa matches an outbound receiver', async () => {
  const { prisma } = freshStore();
  await seed(prisma, { displayName: 'GFS', isaSenderIds: [], isaReceiverIds: ['GFS'] });
  const p = await resolvePartnerByIsa(prisma, 'US', 'GFS', ['US']);
  assert.ok(p);
  assert.equal(p!.displayName, 'GFS');
});

test('resolvePartnerByIsa returns null when neither side matches', async () => {
  const { prisma } = freshStore();
  await seed(prisma, { displayName: 'Sysco', isaSenderIds: ['SYSCO'], isaReceiverIds: [] });
  assert.equal(await resolvePartnerByIsa(prisma, 'OTHER', 'US', ['US']), null);
});

test('resolvePartnerByIsa with empty OUR_ISA_IDS falls back to senderId/receiverId', async () => {
  const { prisma } = freshStore();
  await seed(prisma, { displayName: 'Sysco', isaSenderIds: ['SYSCO'], isaReceiverIds: [] });
  const p = await resolvePartnerByIsa(prisma, 'SYSCO', 'WHATEVER', []);
  assert.ok(p);
  assert.equal(p!.displayName, 'Sysco');
});

// ─────────────────────────────────────────────────────────────
// Phase 6 Sprint 3 — SLA validation
// ─────────────────────────────────────────────────────────────

test('validatePartnerInput rejects SLA with zero or negative withinMinutes', () => {
  assert.throws(
    () =>
      validatePartnerInput({
        displayName: 'ACME',
        isaSenderIds: ['ACME'],
        isaReceiverIds: [],
        slaWindows: [{ setId: '850', direction: 'inbound', withinMinutes: 0 }],
      }),
    PartnerValidationError,
  );
  assert.throws(
    () =>
      validatePartnerInput({
        displayName: 'ACME',
        isaSenderIds: ['ACME'],
        isaReceiverIds: [],
        slaWindows: [{ setId: '850', direction: 'inbound', withinMinutes: -5 }],
      }),
    PartnerValidationError,
  );
});

test('validatePartnerInput rejects SLA with missing setId', () => {
  assert.throws(
    () =>
      validatePartnerInput({
        displayName: 'ACME',
        isaSenderIds: ['ACME'],
        isaReceiverIds: [],
        slaWindows: [{ setId: '', direction: 'inbound', withinMinutes: 60 }],
      }),
    PartnerValidationError,
  );
});

test('validatePartnerInput accepts a clean SLA list', () => {
  assert.doesNotThrow(() =>
    validatePartnerInput({
      displayName: 'ACME',
      isaSenderIds: ['ACME'],
      isaReceiverIds: [],
      slaWindows: [
        { setId: '850', direction: 'inbound', withinMinutes: 60 },
        { setId: '810', direction: 'outbound', withinMinutes: 1440, expectedAckSetId: '997' },
      ],
    }),
  );
});

// ─────────────────────────────────────────────────────────────
// Phase 8 Sprint 3 — connectivity validation
// ─────────────────────────────────────────────────────────────

const VALID_CONNECTIVITY = {
  channel: 'AS2' as const,
  endpoint: 'https://partner.example.com/as2',
  technicalContact: 'edi-ops@partner.example.com',
};

test('validatePartnerInput accepts a clean connectivity record', () => {
  assert.doesNotThrow(() =>
    validatePartnerInput({
      displayName: 'ACME',
      isaSenderIds: ['ACME'],
      isaReceiverIds: [],
      connectivity: VALID_CONNECTIVITY,
    }),
  );
});

test('validatePartnerInput accepts connectivity=null (explicit clear)', () => {
  assert.doesNotThrow(() =>
    validatePartnerInput({
      displayName: 'ACME',
      isaSenderIds: ['ACME'],
      isaReceiverIds: [],
      connectivity: null,
    }),
  );
});

test('validatePartnerInput rejects an unknown connectivity channel', () => {
  assert.throws(
    () =>
      validatePartnerInput({
        displayName: 'ACME',
        isaSenderIds: ['ACME'],
        isaReceiverIds: [],
        // 'CARRIER_PIGEON' is not in CONNECTIVITY_CHANNELS.
        connectivity: { ...VALID_CONNECTIVITY, channel: 'CARRIER_PIGEON' as never },
      }),
    PartnerValidationError,
  );
});

test('validatePartnerInput rejects a blank endpoint', () => {
  assert.throws(
    () =>
      validatePartnerInput({
        displayName: 'ACME',
        isaSenderIds: ['ACME'],
        isaReceiverIds: [],
        connectivity: { ...VALID_CONNECTIVITY, endpoint: '   ' },
      }),
    PartnerValidationError,
  );
});

test('validatePartnerInput rejects an obviously-bad technical contact', () => {
  assert.throws(
    () =>
      validatePartnerInput({
        displayName: 'ACME',
        isaSenderIds: ['ACME'],
        isaReceiverIds: [],
        connectivity: { ...VALID_CONNECTIVITY, technicalContact: 'not-an-email' },
      }),
    PartnerValidationError,
  );
});

test('toRecord exposes connectivity round-trip; unconfigured rows come back null', async () => {
  const { store, prisma } = freshStore();
  // Seed two partners: one with connectivity, one without.
  await prisma.tradingPartner.create({
    data: {
      displayName: 'With',
      isaSenderIds: ['W'],
      isaReceiverIds: [],
      connectivity: {
        channel: 'AS2',
        endpoint: 'https://w.example.com/as2',
        technicalContact: 'ops@w.example.com',
        notes: 'cert rotates yearly',
      },
    } as never,
  });
  await prisma.tradingPartner.create({
    data: { displayName: 'Without', isaSenderIds: ['N'], isaReceiverIds: [] } as never,
  });
  void store;

  const list = await listPartners(prisma);
  const withCx = list.find((p) => p.displayName === 'With')!;
  const without = list.find((p) => p.displayName === 'Without')!;

  assert.deepEqual(withCx.connectivity, {
    channel: 'AS2',
    endpoint: 'https://w.example.com/as2',
    technicalContact: 'ops@w.example.com',
    notes: 'cert rotates yearly',
  });
  // Unconfigured partner: stored as '{}' by the schema default — toRecord
  // reads it back as null so the UI knows there's nothing to show.
  assert.equal(without.connectivity, null);
});

