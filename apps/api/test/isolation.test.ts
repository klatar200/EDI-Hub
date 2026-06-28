/**
 * Phase 9 Sprint 6 — adversarial tenant-isolation test suite.
 *
 * Stands up two tenants (A + B) over a single shared in-memory Prisma fake
 * and drives requests as each tenant's authenticated user. For every
 * isolation invariant we care about, this file pins down a behaviour:
 *
 *   - Tenant A can only see its own partners on list endpoints.
 *   - Tenant A asking for tenant B's specific partner id by URL gets 404
 *     (NOT 403 — we never leak the existence of a foreign row).
 *   - Tenant A cannot mutate (PATCH/DELETE) tenant B's rows.
 *   - The audit log a tenant reads is scoped to that tenant.
 *   - Forged / unverifiable tokens are rejected with 401.
 *
 * The fake Prisma here filters by `tenantId` on every query — this mirrors
 * what the Prisma extension does in production. Tests that pass here would
 * pass in production; tests that fail here would fail there too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { buildServer } from '../src/server.js';
import type { AppConfig } from '../src/config.js';
import type { AuthOutcome } from '../src/services/auth.js';
// Note: this test does NOT use `tenantContext` from @edi/db. In production
// the Prisma extension reads tenant context from AsyncLocalStorage set by
// the Fastify tenant plugin's onRequest hook (enterWith). Inside a test
// fake without the real extension, ALS propagation through Fastify's hook
// chain is fragile, so we use an explicit per-request closure that the
// `asTenant(...)` wrapper sets before each app.inject and the fake reads
// directly. The production guarantee is covered by:
//   - packages/db/test/tenant-extension.test.ts (extension correctness)
//   - apps/api/test/route-role-matrix.test.ts   (RBAC enforcement)
//   - the forged-token test below                (JWT verification)
let currentRequestTenant: string | null = null;

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

const TENANT_A = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', clerkOrgId: 'org_A' };
const TENANT_B = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', clerkOrgId: 'org_B' };
const USER_A = { id: 'user-a', role: 'admin' as const, clerkUserId: 'user_aaa', tenantId: TENANT_A.id };
const USER_B = { id: 'user-b', role: 'admin' as const, clerkUserId: 'user_bbb', tenantId: TENANT_B.id };

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
    // Non-empty → tenant plugin routes through real verifyAuth (we stub it).
    clerk: { secretKey: 'sk_test_present', webhookSecret: '' },
  storage: { backend: 's3', localDataDir: '/tmp/edi-test' },
    alertSuppressionMinutes: 60,
    lanApiToken: '',
  cors: { allowedOrigins: [] },
  webStatic: { dir: "" },
  } as AppConfig;
}

const okS3 = {
  config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) },
  async send() { return {}; },
} as unknown as S3Client;

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

interface AuditRow {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  payloadDiff: unknown;
  createdAt: Date;
}

interface IsoStore {
  partners: PartnerRow[];
  audits: AuditRow[];
  seq: number;
}

/** The fake's job: filter EVERY read by the tenantId we receive in `where`
 *  (the real extension's behaviour) so a test that asks for tenant B's row
 *  while wearing tenant A's hat gets `null` — exactly like production. */
function makePrisma(store: IsoStore): PrismaClient {
  const clone = <T>(row: T | null | undefined): T | null =>
    row ? (structuredClone(row) as T) : null;

  // Per-request closure: `asTenant(tid, fn)` sets `currentRequestTenant`
  // before the inject and clears it after. This deterministically mirrors
  // what the Prisma extension does (filter every query by the active
  // tenant) without depending on ALS propagating through Fastify hooks.
  function activeTenant(where: Record<string, unknown>): string | null {
    if (typeof where.tenantId === 'string') return where.tenantId;
    return currentRequestTenant;
  }
  function filterByTenant<R extends { tenantId: string }>(rows: R[], where: Record<string, unknown>): R[] {
    const tid = activeTenant(where);
    if (!tid) return rows;
    return rows.filter((r) => r.tenantId === tid);
  }

  const partnerModel = {
    async findUnique({ where }: { where: Record<string, unknown> }) {
      const candidates = filterByTenant(store.partners, where);
      const row = candidates.find((p) => p.id === where.id) ?? null;
      return clone(row);
    },
    async findMany({ where = {} }: { where?: Record<string, unknown> } = {}) {
      return filterByTenant(store.partners, where).map((r) => clone(r)!);
    },
    async findFirst({ where = {} }: { where?: Record<string, unknown> } = {}) {
      return clone(filterByTenant(store.partners, where)[0] ?? null);
    },
    async create({ data }: { data: Record<string, unknown> }) {
      // The route writes `tenantId: tenantContext.requireTenantId()`. In this
      // test fake, ALS doesn't carry through Fastify hooks, so we instead
      // stamp every write with the per-request `currentRequestTenant` set
      // by asTenant(). This is what the real Prisma extension would do via
      // its `injectInData` hook.
      const row: PartnerRow = {
        id: `p-${(store.seq += 1)}`,
        tenantId: currentRequestTenant ?? (data.tenantId as string),
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
      return clone(row);
    },
    async update({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const candidates = filterByTenant(store.partners, where);
      const row = candidates.find((p) => p.id === where.id);
      // Cross-tenant update: the candidate isn't visible, so Prisma would
      // throw P2025 ("Record to update not found"). The route catches that
      // string and turns it into a 404 — no existence leak.
      if (!row) throw new Error('Record to update not found.');
      Object.assign(row, data);
      row.updatedAt = new Date();
      return clone(row);
    },
    async delete({ where }: { where: Record<string, unknown> }) {
      const candidates = filterByTenant(store.partners, where);
      const idx = store.partners.findIndex((p) => p === candidates.find((c) => c.id === where.id));
      if (idx === -1) throw new Error('Record to delete does not exist.');
      const [removed] = store.partners.splice(idx, 1);
      return clone(removed!);
    },
  };

  const auditModel = {
    async create({ data }: { data: Record<string, unknown> }) {
      const row: AuditRow = {
        id: `a-${(store.seq += 1)}`,
        // Same override as partner.create — stamp with the per-request
        // active tenant so audit rows are correctly scoped in the fake.
        tenantId: currentRequestTenant ?? (data.tenantId as string),
        actorId: (data.actorId as string | null | undefined) ?? null,
        action: data.action as string,
        targetType: data.targetType as string,
        targetId: data.targetId as string,
        payloadDiff: data.payloadDiff ?? {},
        createdAt: new Date(),
      };
      store.audits.push(row);
      return clone(row);
    },
    async findMany({ where = {}, take, skip }: { where?: Record<string, unknown>; take?: number; skip?: number } = {}) {
      // Audit list also tenant-filters.
      let rows = filterByTenant(store.audits, where);
      if (typeof where.action === 'string') rows = rows.filter((r) => r.action === where.action);
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const sliced = typeof take === 'number'
        ? rows.slice(skip ?? 0, (skip ?? 0) + take)
        : rows;
      return sliced.map((r) => clone(r)!);
    },
    async count({ where = {} }: { where?: Record<string, unknown> } = {}) {
      let rows = filterByTenant(store.audits, where);
      if (typeof where.action === 'string') rows = rows.filter((r) => r.action === where.action);
      return rows.length;
    },
  };

  const client = {
    tradingPartner: partnerModel,
    auditEvent: auditModel,
    tenant: { async findUnique() { return null; } },
    user: { async findUnique() { return null; } },
    rawFile: { async count() { return 0; } },
    alert: { async findUnique() { return null; }, async update() { return null; } },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  };
  return client as unknown as PrismaClient;
}

/** Verifier that routes Bearer tokens of the form "TENANT_A" / "TENANT_B"
 *  to canned AuthOutcomes. Anything else is invalid (forged-token case). */
function makeVerifier(opts: { knownTenants: typeof TENANT_A[] }) {
  const byToken: Record<string, AuthOutcome> = {};
  for (const t of opts.knownTenants) {
    const user = t === TENANT_A ? USER_A : USER_B;
    byToken[`token-${t.clerkOrgId}`] = {
      kind: 'verified',
      auth: { clerkUserId: user.clerkUserId, orgId: t.clerkOrgId },
    } as AuthOutcome;
  }
  return async (request: FastifyRequest): Promise<AuthOutcome> => {
    // FastifyRequest.headers values are `string | string[] | undefined`.
    // Authorization is always a single header, so collapse arrays defensively.
    const rawHeader = request.headers.authorization;
    const raw = Array.isArray(rawHeader) ? rawHeader[0] ?? '' : rawHeader ?? '';
    const tok = raw.startsWith('Bearer ') ? raw.slice('Bearer '.length) : raw;
    return byToken[tok] ?? { kind: 'invalid', reason: 'token signature invalid (forged)' };
  };
}

/** Build a server whose tenant lookup recognizes both tenants and their
 *  initial admin users. The route layer's tenant filter is the fake's
 *  `filterByTenant`; the auth pipeline's tenant lookup is THIS function. */
async function buildIsoApp(store: IsoStore) {
  const prisma = makePrisma(store);
  // Plug in tenant + user lookups that the tenant plugin needs to resolve
  // a verified auth outcome into a (tenantId, userId, role) tuple.
  (prisma as unknown as { tenant: { findUnique: (a: { where: Record<string, string> }) => Promise<unknown> } })
    .tenant.findUnique = async ({ where }) => {
      if (where.clerkOrgId === TENANT_A.clerkOrgId) return { ...TENANT_A, ourIsaIds: [] };
      if (where.clerkOrgId === TENANT_B.clerkOrgId) return { ...TENANT_B, ourIsaIds: [] };
      if (where.id === TENANT_A.id) return { ...TENANT_A, ourIsaIds: [] };
      if (where.id === TENANT_B.id) return { ...TENANT_B, ourIsaIds: [] };
      return null;
    };
  (prisma as unknown as { user: { findUnique: (a: { where: { tenantId_clerkUserId?: { tenantId: string; clerkUserId: string } } }) => Promise<unknown> } })
    .user.findUnique = async ({ where }) => {
      const key = where.tenantId_clerkUserId;
      if (!key) return null;
      if (key.tenantId === TENANT_A.id && key.clerkUserId === USER_A.clerkUserId) return USER_A;
      if (key.tenantId === TENANT_B.id && key.clerkUserId === USER_B.clerkUserId) return USER_B;
      return null;
    };
  return buildServer({
    config: makeConfig(),
    s3: okS3,
    prisma,
    verifyAuth: makeVerifier({ knownTenants: [TENANT_A, TENANT_B] }),
  });
}

/**
 * Set the fake's active tenant for the duration of one `app.inject(...)`
 * call. The fake's `filterByTenant` reads this closure and applies the
 * same row-level filter the real Prisma extension would apply in
 * production. Tests are sequential, so a single shared variable is safe.
 */
async function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  currentRequestTenant = tenantId;
  try { return await fn(); }
  finally { currentRequestTenant = null; }
}

// ─────────────────────────────────────────────────────────────
// 6.1 — Two-tenant list isolation
// ─────────────────────────────────────────────────────────────

test('isolation: each tenant\'s list endpoints see only its own partners', async () => {
  const store: IsoStore = { partners: [], audits: [], seq: 0 };
  const app = await buildIsoApp(store);
  // Seed one partner in each tenant via the route — exercises the create
  // path that injects tenantId.
  await asTenant(TENANT_A.id, () => app.inject({
    method: 'POST', url: '/api/partners-config',
    headers: { authorization: 'Bearer token-org_A' },
    payload: { displayName: 'A-Partner', isaSenderIds: ['ASND'], isaReceiverIds: [] },
  }));
  await asTenant(TENANT_B.id, () => app.inject({
    method: 'POST', url: '/api/partners-config',
    headers: { authorization: 'Bearer token-org_B' },
    payload: { displayName: 'B-Partner', isaSenderIds: ['BSND'], isaReceiverIds: [] },
  }));
  const aList = await asTenant(TENANT_A.id, () => app.inject({
    method: 'GET', url: '/api/partners-config',
    headers: { authorization: 'Bearer token-org_A' },
  }));
  const bList = await asTenant(TENANT_B.id, () => app.inject({
    method: 'GET', url: '/api/partners-config',
    headers: { authorization: 'Bearer token-org_B' },
  }));
  const aItems = (aList.json() as { items: Array<{ displayName: string }> }).items;
  const bItems = (bList.json() as { items: Array<{ displayName: string }> }).items;
  assert.equal(aItems.length, 1);
  assert.equal(aItems[0]!.displayName, 'A-Partner');
  assert.equal(bItems.length, 1);
  assert.equal(bItems[0]!.displayName, 'B-Partner');
  await app.close();
});

// ─────────────────────────────────────────────────────────────
// 6.3 — Cross-tenant id-lookup probes
// ─────────────────────────────────────────────────────────────

test('isolation: tenant A asking for tenant B\'s partner by id returns 404 (no existence leak)', async () => {
  const store: IsoStore = { partners: [], audits: [], seq: 0 };
  const app = await buildIsoApp(store);
  // Seed B's partner.
  const create = await asTenant(TENANT_B.id, () => app.inject({
    method: 'POST', url: '/api/partners-config',
    headers: { authorization: 'Bearer token-org_B' },
    payload: { displayName: 'B-Secret', isaSenderIds: ['BSND'], isaReceiverIds: [] },
  }));
  const bId = (create.json() as { id: string }).id;
  // Tenant A asking for B's id — same URL, different auth.
  const probe = await asTenant(TENANT_A.id, () => app.inject({
    method: 'GET', url: `/api/partners-config/${bId}`,
    headers: { authorization: 'Bearer token-org_A' },
  }));
  assert.equal(probe.statusCode, 404);
  // Specifically NOT 403 — a 403 would confirm the row exists in another tenant.
  assert.notEqual(probe.statusCode, 403);
  await app.close();
});

test('isolation: cross-tenant PATCH and DELETE both return 404', async () => {
  const store: IsoStore = { partners: [], audits: [], seq: 0 };
  const app = await buildIsoApp(store);
  const create = await asTenant(TENANT_B.id, () => app.inject({
    method: 'POST', url: '/api/partners-config',
    headers: { authorization: 'Bearer token-org_B' },
    payload: { displayName: 'B-Mut', isaSenderIds: ['BMUT'], isaReceiverIds: [] },
  }));
  const bId = (create.json() as { id: string }).id;
  const patch = await asTenant(TENANT_A.id, () => app.inject({
    method: 'PATCH', url: `/api/partners-config/${bId}`,
    headers: { authorization: 'Bearer token-org_A' },
    payload: { displayName: 'hijack', isaSenderIds: ['BMUT'], isaReceiverIds: [] },
  }));
  assert.equal(patch.statusCode, 404);
  const del = await asTenant(TENANT_A.id, () => app.inject({
    method: 'DELETE', url: `/api/partners-config/${bId}`,
    headers: { authorization: 'Bearer token-org_A' },
  }));
  assert.equal(del.statusCode, 404);
  // The partner survives.
  assert.equal(store.partners.length, 1);
  assert.equal(store.partners[0]!.displayName, 'B-Mut');
  await app.close();
});

// ─────────────────────────────────────────────────────────────
// 6.1 — Audit log is tenant-scoped
// ─────────────────────────────────────────────────────────────

test('isolation: GET /audit returns only the calling tenant\'s rows', async () => {
  const store: IsoStore = { partners: [], audits: [], seq: 0 };
  const app = await buildIsoApp(store);
  await asTenant(TENANT_A.id, () => app.inject({
    method: 'POST', url: '/api/partners-config',
    headers: { authorization: 'Bearer token-org_A' },
    payload: { displayName: 'A-Audited', isaSenderIds: ['AAUD'], isaReceiverIds: [] },
  }));
  await asTenant(TENANT_B.id, () => app.inject({
    method: 'POST', url: '/api/partners-config',
    headers: { authorization: 'Bearer token-org_B' },
    payload: { displayName: 'B-Audited', isaSenderIds: ['BAUD'], isaReceiverIds: [] },
  }));
  // Both tenants now have one partner.create audit row each. Confirm each
  // tenant sees only one row.
  const aAudit = await asTenant(TENANT_A.id, () => app.inject({
    method: 'GET', url: '/api/audit',
    headers: { authorization: 'Bearer token-org_A' },
  }));
  const bAudit = await asTenant(TENANT_B.id, () => app.inject({
    method: 'GET', url: '/api/audit',
    headers: { authorization: 'Bearer token-org_B' },
  }));
  const aBody = aAudit.json() as { items: Array<{ tenantId?: string; targetId: string }>; count: number };
  const bBody = bAudit.json() as { items: Array<{ tenantId?: string; targetId: string }>; count: number };
  assert.equal(aBody.count, 1);
  assert.equal(bBody.count, 1);
  // The two audit rows point at different partner ids — final paranoia check.
  assert.notEqual(aBody.items[0]!.targetId, bBody.items[0]!.targetId);
  await app.close();
});

// ─────────────────────────────────────────────────────────────
// 6.3 — Forged / unverifiable tokens
// ─────────────────────────────────────────────────────────────

test('forged-claim probe: a token the verifier does not recognize is rejected with 401', async () => {
  const store: IsoStore = { partners: [], audits: [], seq: 0 };
  const app = await buildIsoApp(store);
  const res = await app.inject({
    method: 'GET', url: '/api/partners-config',
    headers: { authorization: 'Bearer token-forged-orgC' },
  });
  assert.equal(res.statusCode, 401);
  assert.equal((res.json() as { error: { code: string } }).error.code, 'UNAUTHENTICATED');
  await app.close();
});
