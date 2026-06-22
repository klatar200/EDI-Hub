/**
 * parseAndStore service tests — decomposition persistence, idempotency, and
 * graceful parse-error flagging. In-memory S3/Prisma fakes; no real infra.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { tenantContext, PILOT_TENANT_ID } from '@edi/db';
import { computeDirection, parseAndStore, type ParsingDeps } from '../src/services/parsing.js';
import type { AppConfig } from '../src/config.js';

// Phase 9 Sprint 1.4 — parseAndStore now requires an active tenant context
// (it reads OUR_ISA_IDS from the tenant row). beforeEach uses enterWith so
// the ALS context propagates into the test body that runs immediately after.
beforeEach(() => {
  tenantContext.enterWith({ tenantId: PILOT_TENANT_ID });
});

const config = {
  port: 0, nodeEnv: 'test', maxFileSizeBytes: 1024 * 1024,
  s3: { bucket: 'b', region: 'us-east-1', endpoint: 'http://localhost:9000', forcePathStyle: true },
  retry: { maxAttempts: 1, baseDelayMs: 1 },
  sftp: { enabled: false, watchDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
  as2: { enabled: false, inboxDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
  ourIsaIds: [],
  notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
  clerk: { secretKey: '', webhookSecret: '' },
  alertSuppressionMinutes: 60,
} as AppConfig;

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, fatal() {}, trace() {}, child() { return noopLogger; } } as never;

function isa(isa13: string): string {
  const e = '*';
  return [
    'ISA', '00', ' '.repeat(10), '00', ' '.repeat(10), 'ZZ', 'SENDER'.padEnd(15),
    'ZZ', 'RECEIVER'.padEnd(15), '260101', '1200', 'U', '00401', isa13, '0', 'P',
  ].join(e) + e + ':' + '~';
}
const VALID_850 = (isa13: string) =>
  isa(isa13) + 'GS*PO*SENDER*RECEIVER*20260101*1200*1*X*004010~' +
  'ST*850*0001~BEG*00*SA*PO-1**20260101~PO1*1*10*EA*25.00**VP*V1~CTT*1~SE*5*0001~GE*1*1~IEA*1*' + isa13 + '~';

interface FakeState {
  row: {
    id: string;
    s3Key: string;
    status: string;
    errorMessage: string | null;
    /** Phase 8 Sprint 1 — used to derive outbound generated/transmitted
     *  timestamps. Optional in the test type so pre-Phase-8 fixtures keep
     *  compiling; makeDeps defaults it to a fixed instant when missing. */
    ingestedAt?: Date;
  };
  interchanges: Map<string, unknown>;
  deletes: number;
}

interface PartnerSeed {
  supportedSets?: string[];
  isaSenderIds?: string[];
  isaReceiverIds?: string[];
}

function makeDeps(content: Buffer, state: FakeState, ourIsaIds: string[] = [], partner?: PartnerSeed): ParsingDeps {
  // Default ingestedAt so older fixtures (set up before Phase 8) keep working.
  if (!state.row.ingestedAt) state.row.ingestedAt = new Date('2026-06-19T12:00:00.000Z');
  const s3 = {
    config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) },
    async send() { return {}; }, // not used: content is passed in-memory
  } as unknown as S3Client;
  let seq = 0;
  const self: PrismaClient = {
    rawFile: {
      async findUnique({ where }: { where: { id?: string } }) { return where.id === state.row.id ? state.row : null; },
      async update({ data }: { where: { id: string }; data: Record<string, unknown> }) { Object.assign(state.row, data); return state.row; },
    },
    interchange: {
      async deleteMany() { state.deletes += 1; const n = state.interchanges.size; state.interchanges.clear(); return { count: n }; },
      async create({ data }: { data: unknown }) { const id = `ic-${(seq += 1)}`; state.interchanges.set(id, data); return { id }; },
    },
    transaction: {
      // Phase 8 Sprint 1 — confirmedAt propagation:
      //  - findMany returns whatever 997 stubs the test seeded as inbound
      //    (none by default), shaped to satisfy the propagator's typed cast.
      //  - updateMany increments a counter and flips confirmedAt on any seeded
      //    outbound originals matching (groupControl + setId + control).
      async findMany() {
        // The propagator only runs for ack interchanges, and tests don't
        // currently exercise it through parseAndStore alongside originals. For
        // the existing fixtures we return [] (no acks scoped to this rawFile)
        // so propagation is a typed no-op; the dedicated propagation tests
        // exercise `propagateConfirmedAtForAcks` directly.
        return [];
      },
      async updateMany(_args: unknown) {
        // No outbound originals seeded here — see findMany note above.
        return { count: 0 };
      },
    },
    // Phase 9 Sprint 1.4 — parseAndStore looks up OUR_ISA_IDS from the
    // tenant row. Wire the test's ourIsaIds arg through here so direction-
    // tagging tests see the values they passed via makeDeps(...).
    tenant: {
      async findUnique() {
        return ourIsaIds.length > 0
          ? {
              id: '00000000-0000-0000-0000-000000000001',
              displayName: 'Pilot',
              clerkOrgId: null,
              ourIsaIds: [...ourIsaIds],
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : null;
      },
    },
    tradingPartner: {
      // Phase 6 — return a stubbed partner row when seeded; otherwise null
      // (no partner configured → existing behavior).
      async findFirst() {
        if (!partner) return null;
        return {
          id: 'p-1', tenantId: null, displayName: 'Stub',
          isaSenderIds: partner.isaSenderIds ?? [],
          isaReceiverIds: partner.isaReceiverIds ?? [],
          status: 'active',
          notes: null,
          contacts: [],
          supportedSets: partner.supportedSets ?? [],
          lifecycleFlows: [],
          ackCodeOverrides: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
    async $transaction(fn: (tx: unknown) => unknown) { return fn(self); },
  } as unknown as PrismaClient;
  void content;
  return { s3, prisma: self, config: { ...config, ourIsaIds }, logger: noopLogger };
}

test('parseAndStore persists the interchange tree and marks the file PARSED', async () => {
  const content = Buffer.from(VALID_850('000000123'));
  const state: FakeState = { row: { id: 'raw-1', s3Key: 'raw/x.edi', status: 'RECEIVED', errorMessage: null }, interchanges: new Map(), deletes: 0 };
  const deps = makeDeps(content, state);

  const result = await parseAndStore(deps, { rawFileId: 'raw-1', content });
  assert.equal(result.outcome, 'parsed');
  if (result.outcome === 'parsed') {
    assert.equal(result.groups, 1);
    assert.equal(result.transactions, 1);
    assert.equal(result.segments, 5);
    assert.equal(result.warnings.length, 0);
  }
  assert.equal(state.interchanges.size, 1);
  assert.equal(state.row.status, 'PARSED');

  // Business keys + semantic labels were captured during persistence.
  interface CreatedElement { index: number; value: string; semanticLabel: string | null }
  interface CreatedSegment { tag: string; position: number; elements: { create: CreatedElement[] } }
  interface CreatedTxn { transactionSetId: string; poNumber: string | null; purpose: string | null; segments: { create: CreatedSegment[] } }
  interface CreatedInterchange { functionalGroups: { create: Array<{ transactions: { create: CreatedTxn[] } }> } }
  const stored = [...state.interchanges.values()][0] as CreatedInterchange;
  const txn = stored.functionalGroups.create[0]!.transactions.create[0]!;
  assert.equal(txn.poNumber, 'PO-1');
  assert.equal(txn.purpose, '00');
  const beg = txn.segments.create.find((sg) => sg.tag === 'BEG')!;
  const beg03 = beg.elements.create.find((e) => e.index === 3)!;
  assert.equal(beg03.semanticLabel, 'Purchase Order Number');
});

test('parseAndStore is idempotent — re-parsing deletes then rebuilds', async () => {
  const content = Buffer.from(VALID_850('000000124'));
  const state: FakeState = { row: { id: 'raw-2', s3Key: 'raw/y.edi', status: 'RECEIVED', errorMessage: null }, interchanges: new Map(), deletes: 0 };
  const deps = makeDeps(content, state);

  await parseAndStore(deps, { rawFileId: 'raw-2', content });
  await parseAndStore(deps, { rawFileId: 'raw-2', content });

  assert.equal(state.interchanges.size, 1, 'still exactly one interchange after re-parse');
  assert.equal(state.deletes, 2, 'each parse deletes existing tree first');
});

test('parseAndStore persists the tree but flags PARSE_ERROR for a semantically broken 850', async () => {
  // Valid envelope, but BEG has no PO number (BEG03 empty).
  const broken =
    isa('000000130') + 'GS*PO*SENDER*RECEIVER*20260101*1200*1*X*004010~' +
    'ST*850*0001~BEG*00*SA***20260101~PO1*1*1*EA*1.00**VP*X~SE*4*0001~GE*1*1~IEA*1*000000130~';
  const content = Buffer.from(broken);
  const state: FakeState = { row: { id: 'raw-5', s3Key: 'raw/v.edi', status: 'RECEIVED', errorMessage: null }, interchanges: new Map(), deletes: 0 };
  const deps = makeDeps(content, state);

  const result = await parseAndStore(deps, { rawFileId: 'raw-5', content });
  assert.equal(result.outcome, 'parsed');
  if (result.outcome === 'parsed') {
    assert.equal(result.status, 'PARSE_ERROR');
    assert.ok(result.issues.some((i) => i.severity === 'error'));
  }
  assert.equal(state.interchanges.size, 1, 'generic tree still persisted');
  assert.equal(state.row.status, 'PARSE_ERROR');
  assert.ok(state.row.errorMessage && state.row.errorMessage.includes('Purchase Order Number'));
});

test('parseAndStore flags PARSE_ERROR on undecomposable input', async () => {
  const content = Buffer.from('ISA*00*broken'); // ISA present but unparseable
  const state: FakeState = { row: { id: 'raw-3', s3Key: 'raw/z.edi', status: 'RECEIVED', errorMessage: null }, interchanges: new Map(), deletes: 0 };
  const deps = makeDeps(content, state);

  const result = await parseAndStore(deps, { rawFileId: 'raw-3', content });
  assert.equal(result.outcome, 'parse_error');
  assert.equal(state.row.status, 'PARSE_ERROR');
  assert.ok(state.row.errorMessage);
  assert.equal(state.interchanges.size, 0, 'nothing persisted on parse error');
});

test('parseAndStore skips an unknown raw file id', async () => {
  const content = Buffer.from(VALID_850('000000125'));
  const state: FakeState = { row: { id: 'raw-4', s3Key: 'raw/w.edi', status: 'RECEIVED', errorMessage: null }, interchanges: new Map(), deletes: 0 };
  const deps = makeDeps(content, state);
  const result = await parseAndStore(deps, { rawFileId: 'does-not-exist', content });
  assert.equal(result.outcome, 'skipped');
});

// ─────────────────────────────────────────────────────────────
// Phase 4 Sprint 1 — lifecycle linkage fields
// ─────────────────────────────────────────────────────────────

/** A 856 ASN sharing the SENDER/RECEIVER pair from the 850 fixture. */
const VALID_856 = (isa13: string) =>
  isa(isa13) + 'GS*SH*SENDER*RECEIVER*20260101*1200*1*X*004010~' +
  ['ST*856*0001', 'BSN*00*SHIP-555*20260103*1200', 'HL*1**S', 'PRF*PO-12345', 'SE*5*0001'].join('~') +
  '~GE*1*1~IEA*1*' + isa13 + '~';

/** A 997 acking two 850s, one accepted one rejected. */
const VALID_997 = (isa13: string) =>
  isa(isa13) + 'GS*FA*RECEIVER*SENDER*20260101*1200*1*X*004010~' +
  ['ST*997*0001', 'AK1*PO*100', 'AK2*850*0001', 'AK5*A', 'AK2*850*0002', 'AK5*R', 'AK9*E*2*2*1', 'SE*8*0001'].join('~') +
  '~GE*1*1~IEA*1*' + isa13 + '~';

interface CreatedTxn {
  transactionSetId: string;
  poNumber: string | null;
  invoiceNumber: string | null;
  shipmentId: string | null;
  ackedGroupControl: string | null;
  ackedTxnControls: Array<{ setId: string; control: string; status: string; statusMessage?: string | null; errors?: unknown[] }> | null;
  ackStatus: string | null;
  direction: 'inbound' | 'outbound' | 'unknown';
}
interface CreatedInterchange { functionalGroups: { create: Array<{ transactions: { create: CreatedTxn[] } }> } }
function firstTxn(state: FakeState): CreatedTxn {
  const stored = [...state.interchanges.values()][0] as CreatedInterchange;
  return stored.functionalGroups.create[0]!.transactions.create[0]!;
}

test('computeDirection tags inbound / outbound / unknown', () => {
  assert.equal(computeDirection('SENDER', 'RECEIVER', ['RECEIVER']), 'inbound');
  assert.equal(computeDirection('SENDER', 'RECEIVER', ['SENDER']), 'outbound');
  assert.equal(computeDirection('SENDER', 'RECEIVER', ['UNRELATED']), 'unknown');
  assert.equal(computeDirection('SENDER', 'RECEIVER', []), 'unknown');
  // Both sides match → meaningless direction; intra-tenant.
  assert.equal(computeDirection('SENDER', 'RECEIVER', ['SENDER', 'RECEIVER']), 'unknown');
});

test('parseAndStore persists shipmentId for an 856', async () => {
  const content = Buffer.from(VALID_856('000000856'));
  const state: FakeState = { row: { id: 'raw-856', s3Key: 'raw/asn.edi', status: 'RECEIVED', errorMessage: null }, interchanges: new Map(), deletes: 0 };
  const deps = makeDeps(content, state);

  const result = await parseAndStore(deps, { rawFileId: 'raw-856', content });
  assert.equal(result.outcome, 'parsed');
  const txn = firstTxn(state);
  assert.equal(txn.transactionSetId, '856');
  assert.equal(txn.shipmentId, 'SHIP-555');
  assert.equal(txn.poNumber, 'PO-12345');
});

test('parseAndStore persists 997 ack-linkage (group control + acked txns + status)', async () => {
  const content = Buffer.from(VALID_997('000000997'));
  const state: FakeState = { row: { id: 'raw-997', s3Key: 'raw/ack.edi', status: 'RECEIVED', errorMessage: null }, interchanges: new Map(), deletes: 0 };
  const deps = makeDeps(content, state);

  const result = await parseAndStore(deps, { rawFileId: 'raw-997', content });
  assert.equal(result.outcome, 'parsed');
  const txn = firstTxn(state);
  assert.equal(txn.transactionSetId, '997');
  assert.equal(txn.ackedGroupControl, '100');
  assert.equal(txn.ackStatus, 'E');
  assert.ok(Array.isArray(txn.ackedTxnControls));
  assert.equal(txn.ackedTxnControls!.length, 2);
  // Phase 5: each acked-txn entry now also carries statusMessage + errors[],
  // so assert the core fields individually and spot-check the enrichments.
  assert.equal(txn.ackedTxnControls![0]!.setId, '850');
  assert.equal(txn.ackedTxnControls![0]!.control, '0001');
  assert.equal(txn.ackedTxnControls![0]!.status, 'A');
  assert.equal(txn.ackedTxnControls![0]!.statusMessage, 'Accepted');
  assert.equal(txn.ackedTxnControls![1]!.setId, '850');
  assert.equal(txn.ackedTxnControls![1]!.control, '0002');
  assert.equal(txn.ackedTxnControls![1]!.status, 'R');
  assert.equal(txn.ackedTxnControls![1]!.statusMessage, 'Rejected');
});

test('parseAndStore tags direction based on OUR_ISA_IDS', async () => {
  // We are RECEIVER → an 850 from SENDER is inbound to us.
  const content = Buffer.from(VALID_850('000000801'));
  const state: FakeState = { row: { id: 'raw-dir-in', s3Key: 'raw/in.edi', status: 'RECEIVED', errorMessage: null }, interchanges: new Map(), deletes: 0 };
  const deps = makeDeps(content, state, ['RECEIVER']);
  await parseAndStore(deps, { rawFileId: 'raw-dir-in', content });
  assert.equal(firstTxn(state).direction, 'inbound');

  // We are SENDER → same 850 would be outbound.
  const content2 = Buffer.from(VALID_850('000000802'));
  const state2: FakeState = { row: { id: 'raw-dir-out', s3Key: 'raw/out.edi', status: 'RECEIVED', errorMessage: null }, interchanges: new Map(), deletes: 0 };
  const deps2 = makeDeps(content2, state2, ['SENDER']);
  await parseAndStore(deps2, { rawFileId: 'raw-dir-out', content: content2 });
  assert.equal(firstTxn(state2).direction, 'outbound');

  // Neither side matches → unknown (default behaviour).
  const content3 = Buffer.from(VALID_850('000000803'));
  const state3: FakeState = { row: { id: 'raw-dir-unk', s3Key: 'raw/unk.edi', status: 'RECEIVED', errorMessage: null }, interchanges: new Map(), deletes: 0 };
  const deps3 = makeDeps(content3, state3, ['SOMEONE_ELSE']);
  await parseAndStore(deps3, { rawFileId: 'raw-dir-unk', content: content3 });
  assert.equal(firstTxn(state3).direction, 'unknown');
});

// ─────────────────────────────────────────────────────────────
// Phase 6 Sprint 2 — partner allow list tags UNCONFIGURED_SET
// ─────────────────────────────────────────────────────────────

interface CreatedTxnConfigFlag { transactionSetId: string; configFlag: string | null }
interface InterchangeFlagsShape { functionalGroups: { create: Array<{ transactions: { create: CreatedTxnConfigFlag[] } }> } }

test('parseAndStore tags UNCONFIGURED_SET when txn set isn\'t in partner allow list', async () => {
  const content = Buffer.from(VALID_850('000000601'));
  const state: FakeState = { row: { id: 'raw-allow', s3Key: 'raw/a.edi', status: 'RECEIVED', errorMessage: null }, interchanges: new Map(), deletes: 0 };
  // Partner only supports 855/810; an 850 should be flagged.
  const deps = makeDeps(content, state, ['RECEIVER'], { supportedSets: ['855', '810'], isaSenderIds: ['SENDER'] });
  await parseAndStore(deps, { rawFileId: 'raw-allow', content });
  const stored = [...state.interchanges.values()][0] as InterchangeFlagsShape;
  const txn = stored.functionalGroups.create[0]!.transactions.create[0]!;
  assert.equal(txn.transactionSetId, '850');
  assert.equal(txn.configFlag, 'UNCONFIGURED_SET');
});

test('parseAndStore leaves configFlag null when partner allow list includes the set', async () => {
  const content = Buffer.from(VALID_850('000000602'));
  const state: FakeState = { row: { id: 'raw-ok', s3Key: 'raw/b.edi', status: 'RECEIVED', errorMessage: null }, interchanges: new Map(), deletes: 0 };
  const deps = makeDeps(content, state, ['RECEIVER'], { supportedSets: ['850', '855', '810'], isaSenderIds: ['SENDER'] });
  await parseAndStore(deps, { rawFileId: 'raw-ok', content });
  const stored = [...state.interchanges.values()][0] as InterchangeFlagsShape;
  assert.equal(stored.functionalGroups.create[0]!.transactions.create[0]!.configFlag, null);
});

test('parseAndStore leaves configFlag null when no partner is configured (backward compat)', async () => {
  const content = Buffer.from(VALID_850('000000603'));
  const state: FakeState = { row: { id: 'raw-none', s3Key: 'raw/c.edi', status: 'RECEIVED', errorMessage: null }, interchanges: new Map(), deletes: 0 };
  const deps = makeDeps(content, state, ['RECEIVER']); // no partner seeded
  await parseAndStore(deps, { rawFileId: 'raw-none', content });
  const stored = [...state.interchanges.values()][0] as InterchangeFlagsShape;
  assert.equal(stored.functionalGroups.create[0]!.transactions.create[0]!.configFlag, null);
});

// ─────────────────────────────────────────────────────────────
// Phase 8 Sprint 1 — outbound lifecycle timestamps
// ─────────────────────────────────────────────────────────────

interface CreatedTxnTimestamps {
  transactionSetId: string;
  direction: 'inbound' | 'outbound' | 'unknown';
  generatedAt?: Date;
  transmittedAt?: Date;
  confirmedAt?: Date;
}
interface InterchangeTimestampsShape {
  functionalGroups: { create: Array<{ transactions: { create: CreatedTxnTimestamps[] } }> };
}

test('parseAndStore sets generatedAt + transmittedAt = ingestedAt on outbound', async () => {
  const ingestedAt = new Date('2026-06-19T08:30:00.000Z');
  const content = Buffer.from(VALID_850('000000810'));
  const state: FakeState = {
    row: { id: 'raw-out', s3Key: 'raw/out.edi', status: 'RECEIVED', errorMessage: null, ingestedAt },
    interchanges: new Map(),
    deletes: 0,
  };
  // We are SENDER → the 850 from SENDER to RECEIVER is outbound.
  const deps = makeDeps(content, state, ['SENDER']);
  await parseAndStore(deps, { rawFileId: 'raw-out', content });
  const stored = [...state.interchanges.values()][0] as InterchangeTimestampsShape;
  const txn = stored.functionalGroups.create[0]!.transactions.create[0]!;
  assert.equal(txn.direction, 'outbound');
  assert.equal(txn.generatedAt?.toISOString(), ingestedAt.toISOString());
  assert.equal(txn.transmittedAt?.toISOString(), ingestedAt.toISOString());
  // confirmedAt is unset until the 997 arrives — explicit "undefined" leaves
  // the column NULL when Prisma writes it.
  assert.equal(txn.confirmedAt, undefined);
});

test('parseAndStore leaves all three timestamps null on inbound', async () => {
  const content = Buffer.from(VALID_850('000000811'));
  const state: FakeState = {
    row: {
      id: 'raw-in',
      s3Key: 'raw/in.edi',
      status: 'RECEIVED',
      errorMessage: null,
      ingestedAt: new Date('2026-06-19T08:30:00.000Z'),
    },
    interchanges: new Map(),
    deletes: 0,
  };
  // We are RECEIVER → inbound.
  const deps = makeDeps(content, state, ['RECEIVER']);
  await parseAndStore(deps, { rawFileId: 'raw-in', content });
  const stored = [...state.interchanges.values()][0] as InterchangeTimestampsShape;
  const txn = stored.functionalGroups.create[0]!.transactions.create[0]!;
  assert.equal(txn.direction, 'inbound');
  assert.equal(txn.generatedAt, undefined);
  assert.equal(txn.transmittedAt, undefined);
  assert.equal(txn.confirmedAt, undefined);
});

test('parseAndStore leaves all three timestamps null on unknown direction', async () => {
  const content = Buffer.from(VALID_850('000000812'));
  const state: FakeState = {
    row: {
      id: 'raw-unk',
      s3Key: 'raw/unk.edi',
      status: 'RECEIVED',
      errorMessage: null,
      ingestedAt: new Date('2026-06-19T08:30:00.000Z'),
    },
    interchanges: new Map(),
    deletes: 0,
  };
  // Neither side matches → unknown direction → no timestamp signal.
  const deps = makeDeps(content, state, ['SOMEONE_ELSE']);
  await parseAndStore(deps, { rawFileId: 'raw-unk', content });
  const stored = [...state.interchanges.values()][0] as InterchangeTimestampsShape;
  const txn = stored.functionalGroups.create[0]!.transactions.create[0]!;
  assert.equal(txn.direction, 'unknown');
  assert.equal(txn.generatedAt, undefined);
  assert.equal(txn.transmittedAt, undefined);
  assert.equal(txn.confirmedAt, undefined);
});
