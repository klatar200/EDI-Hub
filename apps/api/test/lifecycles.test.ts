/**
 * PS-1 — lifecycle list service + route tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import type { S3Client } from '@aws-sdk/client-s3';
import { tenantContext, PILOT_TENANT_ID } from '@edi/db';
import { getLifecycle, summarizeLifecycleEvents } from '../src/services/lifecycle.js';
import { listLifecycles, expectedWarningsFromEvents, summaryNeedsAttention } from '../src/services/lifecycles.js';
import { buildServer } from '../src/server.js';
import type { AppConfig } from '../src/config.js';

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
  generatedAt: Date | null;
  transmittedAt: Date | null;
  confirmedAt: Date | null;
  functionalGroup: {
    controlNumber: string;
    interchange: {
      senderId: string;
      receiverId: string;
      rawFile: { id: string; ingestedAt: Date; isaControlNumber: string | null; source: 'upload' | 'sftp' | 'as2'; status?: string };
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
        rawFile: {
          id: `raw-${o.id}`,
          ingestedAt: new Date(o.ingestedAt),
          isaControlNumber: `00000${o.controlNumber}`.slice(-9),
          source: o.functionalGroup?.interchange?.rawFile?.source ?? 'sftp',
          status: o.functionalGroup?.interchange?.rawFile?.status ?? 'PARSED',
        },
      },
    },
  };
}

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

function matches(t: FakeTxn, where: Record<string, unknown>): boolean {
  if (!fieldMatches(t.poNumber, where.poNumber)) return false;
  if (!fieldMatches(t.invoiceNumber, where.invoiceNumber)) return false;
  if (!fieldMatches(t.shipmentId, where.shipmentId)) return false;
  if (!fieldMatches(t.transactionSetId, where.transactionSetId)) return false;
  const fg = where.functionalGroup as { interchange?: { rawFile?: { status?: { in?: string[] } } } } | undefined;
  const statusIn = fg?.interchange?.rawFile?.status?.in;
  if (statusIn) {
    const st = t.functionalGroup.interchange.rawFile.status ?? 'PARSED';
    if (!statusIn.includes(st)) return false;
  }
  return true;
}

interface PoMeta { po: string; started_at: Date; last_activity_at: Date }

function sqlText(query: unknown): string {
  if (query && typeof query === 'object' && 'strings' in query) {
    return (query as { strings: string[] }).strings.join('?');
  }
  return String(query);
}

function makeListPrisma(txns: FakeTxn[], poMeta: PoMeta[]): PrismaClient {
  const alerts: Array<{ status: string; sourceRef: unknown }> = [
    { status: 'active', sourceRef: { poNumber: 'PO-100' } },
  ];
  return {
    $queryRaw: async (query: unknown, ..._values: unknown[]) => {
      const sql = sqlText(query);
      assert.ok(!sql.includes('DROP TABLE'), 'user input must not appear in raw SQL text');
      if (sql.includes('COUNT(DISTINCT')) {
        return [{ count: BigInt(poMeta.length) }];
      }
      return poMeta;
    },
    alert: {
      async findMany() { return alerts; },
    },
    transaction: {
      async findMany({ where }: { where?: Record<string, unknown> } = {}) {
        const w = where ?? {};
        if (w.distinct) {
          return txns
            .filter((t) => matches(t, w))
            .map((t) => ({ poNumber: t.poNumber }))
            .filter((r) => r.poNumber);
        }
        return txns.filter((t) => matches(t, w));
      },
      async findFirst({ where }: { where: Record<string, unknown> }) {
        const match = txns.find((t) => matches(t, where));
        return match ? { poNumber: match.poNumber } : null;
      },
    },
    tradingPartner: {
      async findFirst() {
        return {
          id: 'p-1', displayName: 'Stub Partner',
          isaSenderIds: ['SENDER'], isaReceiverIds: ['RECEIVER'],
          status: 'active', notes: null, contacts: [],
          supportedSets: [], lifecycleFlows: [], ackCodeOverrides: {},
          connectivity: {}, createdAt: new Date(), updatedAt: new Date(),
        };
      },
      async findMany() {
        return [{
          id: 'p-1', displayName: 'Stub Partner',
          isaSenderIds: ['SENDER'], isaReceiverIds: ['RECEIVER'],
          status: 'active', notes: null, contacts: [],
          supportedSets: [], lifecycleFlows: [], ackCodeOverrides: {},
          connectivity: {}, createdAt: new Date(), updatedAt: new Date(),
        }];
      },
    },
    tenant: {
      async findUnique() { return { ourIsaIds: [] }; },
    },
  } as unknown as PrismaClient;
}

const orig850 = tx({
  id: 't-850', transactionSetId: '850', controlNumber: 'T1', groupControl: '1',
  poNumber: 'PO-100', direction: 'inbound', ingestedAt: '2026-06-01T10:00:00Z',
});
const orig855 = tx({
  id: 't-855', transactionSetId: '855', controlNumber: 'T2', groupControl: '2',
  poNumber: 'PO-100', direction: 'outbound', ingestedAt: '2026-06-02T10:00:00Z',
});
const orig850b = tx({
  id: 't-850b', transactionSetId: '850', controlNumber: 'T9', groupControl: '9',
  poNumber: 'PO-200', direction: 'inbound', ingestedAt: '2026-06-03T10:00:00Z',
});

test('expectedWarningsFromEvents surfaces gap rows as warnings', () => {
  const warnings = expectedWarningsFromEvents([
    { kind: 'gap', transactionSetId: '856', direction: 'outbound', status: 'expected_missing' },
    { kind: 'transaction', transactionSetId: '850', direction: 'inbound', status: 'received' },
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /856/);
});

test('summarizeLifecycleEvents counts received, missing, rejected, duplicates', () => {
  const events = [
    { kind: 'transaction' as const, transactionSetId: '850', direction: 'inbound' as const, status: 'received' as const },
    { kind: 'transaction' as const, transactionSetId: '850', direction: 'inbound' as const, status: 'rejected' as const },
    { kind: 'gap' as const, transactionSetId: '856', direction: 'outbound' as const, status: 'expected_missing' as const },
  ];
  const c = summarizeLifecycleEvents(events as never);
  assert.equal(c.received, 1);
  assert.equal(c.rejected, 1);
  assert.equal(c.missing, 1);
  assert.equal(c.hasDuplicates, true);
  assert.equal(c.additionalDocumentCount, 1);
});

test('listLifecycles returns paginated summaries sorted by startedAt desc', async () => {
  const txns = [orig850, orig855, orig850b];
  const poMeta: PoMeta[] = [
    { po: 'PO-200', started_at: new Date('2026-06-03T10:00:00Z'), last_activity_at: new Date('2026-06-03T10:00:00Z') },
    { po: 'PO-100', started_at: new Date('2026-06-01T10:00:00Z'), last_activity_at: new Date('2026-06-02T10:00:00Z') },
  ];
  const prisma = makeListPrisma(txns, poMeta);

  const result = await tenantContext.run({ tenantId: PILOT_TENANT_ID }, () =>
    listLifecycles(prisma, { page: 1, pageSize: 25 }, { ourIsaIds: [] }),
  );

  assert.equal(result.total, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]!.po, 'PO-200');
  assert.equal(result.items[1]!.po, 'PO-100');
  assert.equal(result.items[1]!.openAlertCount, 1);
  assert.ok(result.items[1]!.received >= 1);
  // PS-2 — expected-document warnings derived from gap rows in the timeline.
  const po100 = result.items.find((i) => i.po === 'PO-100');
  assert.ok(po100);
  assert.ok(Array.isArray(po100!.expectedWarnings));
  assert.ok(po100!.expectedWarnings.length > 0, 'missing-doc gaps should surface as expectedWarnings');
});

test('listLifecycles filters hasAlerts=true', async () => {
  const txns = [orig850, orig850b];
  const poMeta: PoMeta[] = [
    { po: 'PO-200', started_at: new Date('2026-06-03T10:00:00Z'), last_activity_at: new Date('2026-06-03T10:00:00Z') },
    { po: 'PO-100', started_at: new Date('2026-06-01T10:00:00Z'), last_activity_at: new Date('2026-06-01T10:00:00Z') },
  ];
  const prisma = makeListPrisma(txns, poMeta);

  const result = await tenantContext.run({ tenantId: PILOT_TENANT_ID }, () =>
    listLifecycles(prisma, { hasAlerts: true }, { ourIsaIds: [] }),
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]!.po, 'PO-100');
});

test('summaryNeedsAttention flags problems and ignores healthy POs', () => {
  assert.equal(
    summaryNeedsAttention({ missing: 0, rejected: 0, openAlertCount: 0, hasParseError: false }),
    false,
  );
  assert.equal(summaryNeedsAttention({ missing: 1, rejected: 0, openAlertCount: 0, hasParseError: false }), true);
  assert.equal(summaryNeedsAttention({ missing: 0, rejected: 2, openAlertCount: 0, hasParseError: false }), true);
  assert.equal(summaryNeedsAttention({ missing: 0, rejected: 0, openAlertCount: 3, hasParseError: false }), true);
  assert.equal(summaryNeedsAttention({ missing: 0, rejected: 0, openAlertCount: 0, hasParseError: true }), true);
});

test('listLifecycles filters partnerId', async () => {
  const txns = [orig850, orig850b];
  const poMeta: PoMeta[] = [
    { po: 'PO-100', started_at: new Date('2026-06-01T10:00:00Z'), last_activity_at: new Date('2026-06-01T10:00:00Z') },
    { po: 'PO-200', started_at: new Date('2026-06-03T10:00:00Z'), last_activity_at: new Date('2026-06-03T10:00:00Z') },
  ];
  const prisma = makeListPrisma(txns, poMeta);

  const lc = await getLifecycle(prisma, { po: 'PO-100' }, { ourIsaIds: [] });
  assert.ok(lc?.partner);

  const result = await tenantContext.run({ tenantId: PILOT_TENANT_ID }, () =>
    listLifecycles(prisma, { partnerId: 'p-1' }, { ourIsaIds: [] }),
  );

  assert.ok(result.items.every((i) => i.partnerId === 'p-1'));
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
  storage: { backend: 's3', localDataDir: '/tmp/edi-test' },
  alertSuppressionMinutes: 60,
    lanApiToken: '',
  cors: { allowedOrigins: [] },
  webStatic: { dir: '' },
} as AppConfig;

const fakeS3 = { config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) }, async send() { return {}; } } as unknown as S3Client;

test('listLifecycles tolerates malicious pos filter values without SQL injection', async () => {
  const malicious = "'; DROP TABLE transactions; --";
  const txns = [
    tx({
      id: 't-evil', transactionSetId: '850', controlNumber: 'T1', groupControl: '1',
      poNumber: malicious, direction: 'inbound', ingestedAt: '2026-06-01T10:00:00Z',
    }),
  ];
  const poMeta: PoMeta[] = [
    { po: malicious, started_at: new Date('2026-06-01T10:00:00Z'), last_activity_at: new Date('2026-06-01T10:00:00Z') },
  ];
  const prisma = makeListPrisma(txns, poMeta);

  const result = await tenantContext.run({ tenantId: PILOT_TENANT_ID }, () =>
    listLifecycles(prisma, { pos: [malicious] }, { ourIsaIds: [] }),
  );

  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]!.po, malicious);
});

test('GET /api/lifecycles returns paginated list shape', async () => {
  const poMeta: PoMeta[] = [
    { po: 'PO-100', started_at: new Date('2026-06-01T10:00:00Z'), last_activity_at: new Date('2026-06-02T10:00:00Z') },
  ];
  const prisma = makeListPrisma([orig850, orig855], poMeta);
  const app = await buildServer({ config, s3: fakeS3, prisma });
  const res = await app.inject({ method: 'GET', url: '/api/lifecycles?page=1&pageSize=10' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { items: unknown[]; page: number; pageSize: number; total: number };
  assert.equal(body.page, 1);
  assert.equal(body.pageSize, 10);
  assert.equal(typeof body.total, 'number');
  assert.ok(Array.isArray(body.items));
  await app.close();
});
