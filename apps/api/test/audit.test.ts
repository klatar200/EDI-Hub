/**
 * Phase 9 Sprint 4 — audit log + secrets loader tests.
 *
 * Three concerns covered here:
 *   1. Every mutating route writes a matching audit row inside the same
 *      $transaction. We verify by driving the routes via app.inject against
 *      a fake Prisma that captures audit.create calls.
 *   2. GET /audit (admin-only) returns and filters the captured rows.
 *   3. The secrets loader honors a fake SecretSource — EnvSecretSource path
 *      and SecretsManagerSecretSource overlay path.
 *
 * The fake Prisma is hand-rolled (not a Jest mock) so each test is a single
 * Node `test()` block with no shared mutable state — every assertion stands
 * alone if you read it top to bottom.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { buildServer } from '../src/server.js';
import type { AppConfig } from '../src/config.js';
import type { AuthOutcome } from '../src/services/auth.js';
import {
  EnvSecretSource,
  applySecretsFromManager,
  type SecretSource,
} from '../src/services/secrets.js';

// ─────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────

function makeConfig(): AppConfig {
  return {
    port: 0,
    nodeEnv: 'test',
    maxFileSizeBytes: 1024 * 1024,
    s3: { bucket: 'b', region: 'us-east-1', endpoint: 'http://localhost:9000', forcePathStyle: true },
    retry: { maxAttempts: 1, baseDelayMs: 1 },
    sftp: { enabled: false, watchDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
    as2: { enabled: false, inboxDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
    ourIsaIds: [],
    notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
    // Empty clerk secret → dev-fallback mode → role checks pass + auth=null.
    clerk: { secretKey: '', webhookSecret: '' },
  storage: { backend: 's3', localDataDir: '/tmp/edi-test' },
    alertSuppressionMinutes: 60,
  cors: { allowedOrigins: [] },
  webStatic: { dir: "" },
  } as AppConfig;
}

const okS3 = {
  config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) },
  async send() { return {}; },
} as unknown as S3Client;

interface CapturedAudit {
  tenantId: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  payloadDiff: unknown;
  createdAt: Date;
  id: string;
}

interface PartnerRow {
  id: string;
  tenantId: string;
  displayName: string;
  isaSenderIds: string[];
  isaReceiverIds: string[];
  status: 'active' | 'disabled';
  notes: string | null;
  contacts: unknown;
  supportedSets: string[];
  lifecycleFlows: unknown;
  ackCodeOverrides: unknown;
  slaWindows: unknown;
  connectivity: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeStore {
  partners: PartnerRow[];
  audits: CapturedAudit[];
  seq: number;
}

/**
 * Build a Prisma fake that supports the surface area the audit-wrapped
 * routes touch:
 *   - tradingPartner.findUnique / findMany / create / update / delete
 *   - auditEvent.create / findMany (with action / actorId / createdAt filter)
 *   - $transaction — executes the callback with `this` as the tx client.
 *     Our fake commits eagerly; that's fine for unit tests because we only
 *     care that audit.create was called within the same logical scope.
 */
function makePrisma(store: FakeStore): PrismaClient {
  function nowSeq(): string { return `id-${(store.seq += 1)}`; }

  // Minimal where-matcher: handles the operators assertNoIsaOverlap uses
  // (`id: { not }`, `OR`, `isaSenderIds.has/hasSome`, `isaReceiverIds.has/hasSome`).
  // Without this the PATCH route's self-overlap check would always hit
  // because the fake would return the partner being updated as a conflict.
  function matches(row: PartnerRow, where: Record<string, unknown>): boolean {
    if (where.id !== undefined) {
      const id = where.id as string | { not?: string };
      if (typeof id === 'string' && row.id !== id) return false;
      if (typeof id === 'object' && id.not !== undefined && row.id === id.not) return false;
    }
    if (where.OR) {
      const ors = where.OR as Array<Record<string, unknown>>;
      if (!ors.some((or) => matches(row, or))) return false;
    }
    const sender = where.isaSenderIds as { has?: string; hasSome?: string[] } | undefined;
    if (sender?.has && !row.isaSenderIds.includes(sender.has)) return false;
    if (sender?.hasSome && !sender.hasSome.some((s) => row.isaSenderIds.includes(s))) return false;
    const receiver = where.isaReceiverIds as { has?: string; hasSome?: string[] } | undefined;
    if (receiver?.has && !row.isaReceiverIds.includes(receiver.has)) return false;
    if (receiver?.hasSome && !receiver.hasSome.some((s) => row.isaReceiverIds.includes(s))) return false;
    return true;
  }

  // Real Prisma returns a fresh object per query — the route relies on this
  // so the `before` snapshot survives the subsequent `update`. The fake
  // would otherwise hand back the live store reference and Object.assign
  // would mutate the snapshot in place.
  const clone = <T>(row: T | null | undefined): T | null =>
    row ? (structuredClone(row) as T) : null;

  const partnerModel = {
    async findUnique({ where }: { where: { id: string } }) {
      return clone(store.partners.find((p) => p.id === where.id) ?? null);
    },
    async findMany({ where }: { where?: Record<string, unknown> } = {}) {
      const rows = where ? store.partners.filter((r) => matches(r, where)) : [...store.partners];
      return rows.map((r) => clone(r)!);
    },
    async findFirst({ where }: { where?: Record<string, unknown> } = {}) {
      const row = where ? store.partners.find((r) => matches(r, where)) : store.partners[0];
      return clone(row ?? null);
    },
    async create({ data }: { data: Record<string, unknown> }) {
      const row: PartnerRow = {
        id: nowSeq(),
        tenantId: data.tenantId as string,
        displayName: data.displayName as string,
        isaSenderIds: (data.isaSenderIds as string[] | undefined) ?? [],
        isaReceiverIds: (data.isaReceiverIds as string[] | undefined) ?? [],
        status: ((data.status as 'active' | 'disabled' | undefined) ?? 'active'),
        notes: (data.notes as string | null | undefined) ?? null,
        contacts: data.contacts ?? [],
        supportedSets: (data.supportedSets as string[] | undefined) ?? [],
        lifecycleFlows: data.lifecycleFlows ?? [],
        ackCodeOverrides: data.ackCodeOverrides ?? {},
        slaWindows: data.slaWindows ?? [],
        connectivity: data.connectivity ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.partners.push(row);
      return row;
    },
    async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
      const row = store.partners.find((p) => p.id === where.id);
      if (!row) throw new Error('Record to update not found.');
      Object.assign(row, data);
      row.updatedAt = new Date();
      return row;
    },
    async delete({ where }: { where: { id: string } }) {
      const idx = store.partners.findIndex((p) => p.id === where.id);
      if (idx === -1) throw new Error('Record to delete does not exist.');
      const [removed] = store.partners.splice(idx, 1);
      return removed!;
    },
  };

  const auditModel = {
    async create({ data }: { data: Record<string, unknown> }) {
      const row: CapturedAudit = {
        id: nowSeq(),
        tenantId: data.tenantId as string,
        actorId: (data.actorId as string | null | undefined) ?? null,
        action: data.action as string,
        targetType: data.targetType as string,
        targetId: data.targetId as string,
        payloadDiff: data.payloadDiff ?? {},
        createdAt: new Date(),
      };
      store.audits.push(row);
      return row;
    },
    async findMany({
      where = {},
      take = 50,
      skip = 0,
    }: {
      where?: Record<string, unknown>;
      orderBy?: unknown;
      take?: number;
      skip?: number;
    } = {}) {
      let rows = [...store.audits];
      if (typeof where.action === 'string') rows = rows.filter((r) => r.action === where.action);
      if (typeof where.actorId === 'string') rows = rows.filter((r) => r.actorId === where.actorId);
      const range = where.createdAt as { gte?: Date; lte?: Date } | undefined;
      if (range?.gte) rows = rows.filter((r) => r.createdAt.getTime() >= range.gte!.getTime());
      if (range?.lte) rows = rows.filter((r) => r.createdAt.getTime() <= range.lte!.getTime());
      // Most-recent-first ordering, matching the route.
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return rows.slice(skip, skip + take);
    },
  };

  const tenantModel = {
    async findUnique() { return null; },
  };
  const userModel = {
    async findUnique() { return null; },
  };
  const rawFileModel = { async count() { return 0; } };

  const client = {
    tradingPartner: partnerModel,
    auditEvent: auditModel,
    tenant: tenantModel,
    user: userModel,
    rawFile: rawFileModel,
    // Alert surface is unused by this test file — the alerts route already
    // has its own dedicated test coverage. We expose stub methods only so
    // the Prisma interface shape is satisfied if Fastify tries a probe.
    alert: {
      async findUnique() { return null; },
      async update() { return null; },
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  };
  return client as unknown as PrismaClient;
}

const verifyDevFallback = async (): Promise<AuthOutcome> => ({ kind: 'dev-fallback' });

async function buildApp(store: FakeStore) {
  return buildServer({
    config: makeConfig(),
    s3: okS3,
    prisma: makePrisma(store),
    verifyAuth: verifyDevFallback,
  });
}

// ─────────────────────────────────────────────────────────────
// Audit emission — partners-config write paths
// ─────────────────────────────────────────────────────────────

test('POST /partners-config creates the partner AND a partner.create audit row', async () => {
  const store: FakeStore = { partners: [], audits: [], seq: 0 };
  const app = await buildApp(store);
  const res = await app.inject({
    method: 'POST',
    url: '/api/partners-config',
    payload: {
      displayName: 'Sysco Test',
      isaSenderIds: ['SYSCO-T'],
      isaReceiverIds: [],
    },
  });
  assert.equal(res.statusCode, 201);

  assert.equal(store.partners.length, 1, 'partner row written');
  assert.equal(store.audits.length, 1, 'one audit row written');
  const audit = store.audits[0]!;
  assert.equal(audit.action, 'partner.create');
  assert.equal(audit.targetType, 'tradingPartner');
  assert.equal(audit.targetId, store.partners[0]!.id);
  // dev-fallback → no real user, actorId is null
  assert.equal(audit.actorId, null);
  // After-snapshot present, before omitted (create has no before).
  const diff = audit.payloadDiff as { before?: unknown; after?: unknown };
  assert.equal(diff.before, undefined);
  assert.ok(diff.after, 'after snapshot present');
  await app.close();
});

test('PATCH /partners-config/:id writes a partner.update audit row with before+after diff', async () => {
  const store: FakeStore = { partners: [], audits: [], seq: 0 };
  const app = await buildApp(store);
  // Seed via the POST so we have a stable id.
  const create = await app.inject({
    method: 'POST',
    url: '/api/partners-config',
    payload: { displayName: 'GFS', isaSenderIds: ['GFS'], isaReceiverIds: [] },
  });
  assert.equal(create.statusCode, 201);
  const partnerId = (create.json() as { id: string }).id;
  store.audits.length = 0; // discard the create audit row, isolate the update

  const patch = await app.inject({
    method: 'PATCH',
    url: `/api/partners-config/${partnerId}`,
    payload: {
      displayName: 'GFS-RENAMED',
      isaSenderIds: ['GFS'],
      isaReceiverIds: [],
    },
  });
  assert.equal(patch.statusCode, 200);
  assert.equal(store.audits.length, 1);
  const audit = store.audits[0]!;
  assert.equal(audit.action, 'partner.update');
  const diff = audit.payloadDiff as { before?: { displayName: string }; after?: { displayName: string } };
  assert.equal(diff.before?.displayName, 'GFS', 'before snapshot has original name');
  assert.equal(diff.after?.displayName, 'GFS-RENAMED', 'after snapshot has new name');
  await app.close();
});

test('DELETE /partners-config/:id writes a partner.delete audit row with the before snapshot', async () => {
  const store: FakeStore = { partners: [], audits: [], seq: 0 };
  const app = await buildApp(store);
  const create = await app.inject({
    method: 'POST',
    url: '/api/partners-config',
    payload: { displayName: 'Doomed', isaSenderIds: ['X'], isaReceiverIds: [] },
  });
  const partnerId = (create.json() as { id: string }).id;
  store.audits.length = 0;

  const del = await app.inject({ method: 'DELETE', url: `/api/partners-config/${partnerId}` });
  assert.equal(del.statusCode, 204);
  assert.equal(store.audits.length, 1);
  assert.equal(store.audits[0]!.action, 'partner.delete');
  const diff = store.audits[0]!.payloadDiff as { before?: { displayName: string } };
  assert.equal(diff.before?.displayName, 'Doomed');
  await app.close();
});

// ─────────────────────────────────────────────────────────────
// GET /audit — admin-only read + filters
// ─────────────────────────────────────────────────────────────

test('GET /audit returns audit rows newest-first', async () => {
  const store: FakeStore = { partners: [], audits: [], seq: 0 };
  const app = await buildApp(store);
  // Generate three audit rows by hitting POST three times.
  for (const name of ['One', 'Two', 'Three']) {
    await app.inject({
      method: 'POST',
      url: '/api/partners-config',
      payload: { displayName: name, isaSenderIds: [`S-${name}`], isaReceiverIds: [] },
    });
  }
  const list = await app.inject({ method: 'GET', url: '/api/audit' });
  assert.equal(list.statusCode, 200);
  const body = list.json() as { items: Array<{ action: string }>; count: number };
  assert.equal(body.count, 3);
  // All three should be partner.create. The route orders by createdAt DESC.
  for (const item of body.items) assert.equal(item.action, 'partner.create');
  await app.close();
});

test('GET /audit?action= filters to a single action verb', async () => {
  const store: FakeStore = { partners: [], audits: [], seq: 0 };
  const app = await buildApp(store);
  const create = await app.inject({
    method: 'POST',
    url: '/api/partners-config',
    payload: { displayName: 'P1', isaSenderIds: ['P1'], isaReceiverIds: [] },
  });
  const id = (create.json() as { id: string }).id;
  await app.inject({
    method: 'PATCH',
    url: `/api/partners-config/${id}`,
    payload: { displayName: 'P1-mod', isaSenderIds: ['P1'], isaReceiverIds: [] },
  });
  // 2 rows total: one create, one update.
  const onlyUpdates = await app.inject({ method: 'GET', url: '/api/audit?action=partner.update' });
  assert.equal(onlyUpdates.statusCode, 200);
  const body = onlyUpdates.json() as { items: Array<{ action: string }>; count: number };
  assert.equal(body.count, 1);
  assert.equal(body.items[0]!.action, 'partner.update');
  await app.close();
});

test('GET /audit rejects an unparseable `from` value', async () => {
  const store: FakeStore = { partners: [], audits: [], seq: 0 };
  const app = await buildApp(store);
  const res = await app.inject({ method: 'GET', url: '/api/audit?from=not-a-date' });
  assert.equal(res.statusCode, 400);
  assert.equal((res.json() as { error: { code: string } }).error.code, 'INVALID_QUERY');
  await app.close();
});

// ─────────────────────────────────────────────────────────────
// Atomicity: a failed audit insert rolls back the data write
// ─────────────────────────────────────────────────────────────
//
// The contract: `withAudit` uses `prisma.$transaction`, and audit failure
// inside it MUST cause the data write to roll back too — otherwise the
// audit log silently drifts from reality. We can't easily simulate Prisma
// $transaction rollback against the fake store (it commits eagerly), so
// we test the contract by failing the AUDIT side and verifying the route
// surfaces a 500 — i.e. doesn't swallow the audit failure.

test('failed audit insert surfaces as a 500 (not silently swallowed)', async () => {
  const store: FakeStore = { partners: [], audits: [], seq: 0 };
  const prisma = makePrisma(store);
  // Replace audit.create with one that always throws.
  (prisma as unknown as { auditEvent: { create: () => Promise<unknown> } }).auditEvent.create =
    async () => {
      throw new Error('synthetic audit failure');
    };
  const app = await buildServer({
    config: makeConfig(),
    s3: okS3,
    prisma,
    verifyAuth: verifyDevFallback,
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/partners-config',
    payload: { displayName: 'Will Fail', isaSenderIds: ['F'], isaReceiverIds: [] },
  });
  // The route doesn't catch this — Fastify surfaces it as a 500. That's
  // intentional: silent audit gaps are worse than user-facing errors.
  assert.equal(res.statusCode, 500);
  assert.equal(store.audits.length, 0, 'no audit row written');
  await app.close();
});

// ─────────────────────────────────────────────────────────────
// Secret loader
// ─────────────────────────────────────────────────────────────

test('EnvSecretSource reads from process.env and returns undefined for missing vars', async () => {
  const src = new EnvSecretSource();
  process.env.__AUDIT_TEST_SECRET = 'hello';
  try {
    assert.equal(await src.get('__AUDIT_TEST_SECRET'), 'hello');
    assert.equal(await src.get('__AUDIT_TEST_MISSING'), undefined);
    // Whitespace-only is treated as absent.
    process.env.__AUDIT_TEST_BLANK = '   ';
    assert.equal(await src.get('__AUDIT_TEST_BLANK'), undefined);
  } finally {
    delete process.env.__AUDIT_TEST_SECRET;
    delete process.env.__AUDIT_TEST_BLANK;
  }
});

test('applySecretsFromManager overlays secrets onto a config', async () => {
  const config = makeConfig();
  config.clerk.secretKey = 'env-fallback';
  // Fake SM source — only returns the override for CLERK_SECRET_KEY.
  const fakeSource: SecretSource = {
    async get(name) {
      if (name === 'CLERK_SECRET_KEY') return 'sm-override';
      if (name === 'CLERK_WEBHOOK_SECRET') return 'sm-whsec';
      return undefined;
    },
  };
  const overlaid = await applySecretsFromManager(config, fakeSource);
  assert.equal(overlaid.clerk.secretKey, 'sm-override');
  assert.equal(overlaid.clerk.webhookSecret, 'sm-whsec');
  // Fields not overridden keep their original values.
  assert.equal(overlaid.notifier.globalSlackWebhook, '');
});

test('applySecretsFromManager leaves config unchanged when source returns undefined for everything', async () => {
  const config = makeConfig();
  config.clerk.secretKey = 'keep-me';
  const emptySource: SecretSource = { async get() { return undefined; } };
  const overlaid = await applySecretsFromManager(config, emptySource);
  assert.equal(overlaid.clerk.secretKey, 'keep-me');
});

test('applySecretsFromManager mirrors DATABASE_URL into process.env so Prisma can read it', async () => {
  const config = makeConfig();
  const previous = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    const source: SecretSource = {
      async get(name) {
        if (name === 'DATABASE_URL') return 'postgresql://from-sm/db';
        return undefined;
      },
    };
    await applySecretsFromManager(config, source);
    assert.equal(process.env.DATABASE_URL, 'postgresql://from-sm/db');
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
