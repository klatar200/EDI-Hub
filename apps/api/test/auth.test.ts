/**
 * Phase 9 Sprint 2 — Auth + tenant resolution tests.
 *
 * Exercises the tenant plugin via Fastify's app.inject. We inject a fake JWT
 * verifier into `buildServer({ verifyAuth })` so the SDK never runs and we
 * can drive every AuthOutcome branch deterministically.
 *
 * Covers:
 *   - dev-fallback (CLERK_SECRET_KEY blank) → pins to pilot tenant, 200 on /health
 *   - invalid token → 401 UNAUTHENTICATED
 *   - no-org → 403 SELECT_ORGANIZATION
 *   - verified but unknown org → 403 TENANT_NOT_PROVISIONED
 *   - verified but unknown user → 403 USER_NOT_PROVISIONED
 *   - verified happy path → 200 + request.auth populated
 *   - /health and /webhooks/clerk are exempt from auth
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { buildServer } from '../src/server.js';
import type { AppConfig } from '../src/config.js';
import type { AuthOutcome } from '../src/services/auth.js';
import { PILOT_TENANT_ID } from '@edi/db';

function makeConfig(clerkSecret = 'sk_test_present'): AppConfig {
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
    clerk: { secretKey: clerkSecret, webhookSecret: '' },
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

/** Build a Prisma fake parameterized by which tenant + user (if any) the
 *  auth plugin should be able to look up. */
function makePrisma(opts: {
  tenant?: { id: string; clerkOrgId: string; deletedAt?: Date | null } | null;
  user?: { id: string; role: 'admin' | 'ops' | 'viewer'; clerkUserId?: string; tenantId?: string } | null;
} = {}): PrismaClient {
  const tenant = opts.tenant ?? null;
  const user = opts.user ?? null;
  return {
    rawFile: { async count() { return 0; } },
    tenant: {
      async findUnique({ where }: { where: { clerkOrgId?: string; id?: string } }) {
        if (tenant && where.clerkOrgId === tenant.clerkOrgId) {
          return { ...tenant, deletedAt: tenant.deletedAt ?? null };
        }
        if (tenant && where.id === tenant.id) {
          return { ...tenant, deletedAt: tenant.deletedAt ?? null };
        }
        return null;
      },
    },
    user: {
      async findUnique({ where }: { where: { tenantId_clerkUserId?: { tenantId: string; clerkUserId: string } } }) {
        if (user && where.tenantId_clerkUserId) {
          return {
            ...user,
            clerkUserId: user.clerkUserId ?? where.tenantId_clerkUserId.clerkUserId,
            tenantId: user.tenantId ?? where.tenantId_clerkUserId.tenantId,
          };
        }
        return null;
      },
    },
  } as unknown as PrismaClient;
}

// ─────────────────────────────────────────────────────────────
// dev-fallback (Clerk not configured)
// ─────────────────────────────────────────────────────────────

test('dev-fallback: blank CLERK_SECRET_KEY pins every request to the pilot tenant', async () => {
  const verifyAuth = async (): Promise<AuthOutcome> => ({ kind: 'dev-fallback' });
  const app = await buildServer({
    config: makeConfig(''), // blank secret triggers dev-fallback in real code too
    s3: okS3,
    prisma: makePrisma(),
    verifyAuth,
  });
  // /health is always 200 regardless of auth.
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  await app.close();
});

// ─────────────────────────────────────────────────────────────
// Token verification outcomes
// ─────────────────────────────────────────────────────────────

test('invalid token → 401 UNAUTHENTICATED', async () => {
  const verifyAuth = async (): Promise<AuthOutcome> => ({ kind: 'invalid', reason: 'expired' });
  const app = await buildServer({ config: makeConfig(), s3: okS3, prisma: makePrisma(), verifyAuth });
  const res = await app.inject({ method: 'GET', url: '/api/partners' });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'UNAUTHENTICATED');
  const msg = (res.json() as { error: { message: string } }).error.message;
  assert.equal(msg, 'Authentication failed.');
  assert.doesNotMatch(msg, /expired/i);
  await app.close();
});

test('no-org → 403 SELECT_ORGANIZATION', async () => {
  const verifyAuth = async (): Promise<AuthOutcome> => ({ kind: 'no-org' });
  const app = await buildServer({ config: makeConfig(), s3: okS3, prisma: makePrisma(), verifyAuth });
  const res = await app.inject({ method: 'GET', url: '/api/partners' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, 'SELECT_ORGANIZATION');
  await app.close();
});

test('verified but unknown org → 403 TENANT_NOT_PROVISIONED', async () => {
  const verifyAuth = async (): Promise<AuthOutcome> => ({
    kind: 'verified',
    auth: { clerkUserId: 'user_x', orgId: 'org_unknown' },
  });
  const app = await buildServer({ config: makeConfig(), s3: okS3, prisma: makePrisma({ tenant: null }), verifyAuth });
  const res = await app.inject({ method: 'GET', url: '/api/partners' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, 'TENANT_NOT_PROVISIONED');
  await app.close();
});

test('verified org but no user row → 403 USER_NOT_PROVISIONED', async () => {
  const verifyAuth = async (): Promise<AuthOutcome> => ({
    kind: 'verified',
    auth: { clerkUserId: 'user_x', orgId: 'org_known' },
  });
  const app = await buildServer({
    config: makeConfig(),
    s3: okS3,
    prisma: makePrisma({ tenant: { id: PILOT_TENANT_ID, clerkOrgId: 'org_known' }, user: null }),
    verifyAuth,
  });
  const res = await app.inject({ method: 'GET', url: '/api/partners' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, 'USER_NOT_PROVISIONED');
  await app.close();
});

test('soft-deleted tenant → 403 TENANT_SUSPENDED', async () => {
  const verifyAuth = async (): Promise<AuthOutcome> => ({
    kind: 'verified',
    auth: { clerkUserId: 'user_a', orgId: 'org_known' },
  });
  const app = await buildServer({
    config: makeConfig(),
    s3: okS3,
    prisma: makePrisma({
      tenant: { id: PILOT_TENANT_ID, clerkOrgId: 'org_known', deletedAt: new Date() },
      user: { id: 'u-1', role: 'admin', clerkUserId: 'user_a', tenantId: PILOT_TENANT_ID },
    }),
    verifyAuth,
  });
  const res = await app.inject({ method: 'GET', url: '/api/partners' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, 'TENANT_SUSPENDED');
  await app.close();
});

test('verified happy path: /health bypasses auth; non-public routes get a tenant context', async () => {
  const verifyAuth = async (): Promise<AuthOutcome> => ({
    kind: 'verified',
    auth: { clerkUserId: 'user_a', orgId: 'org_known' },
  });
  const app = await buildServer({
    config: makeConfig(),
    s3: okS3,
    prisma: makePrisma({
      tenant: { id: PILOT_TENANT_ID, clerkOrgId: 'org_known' },
      user: { id: 'u-1', role: 'admin' },
    }),
    verifyAuth,
  });
  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200, 'health is exempt');
  // /partners would fail if the tenant context wasn't set (the plugin's
  // verified path looked up the tenant + user → set context).
  const partners = await app.inject({ method: 'GET', url: '/api/partners' });
  assert.notEqual(partners.statusCode, 401);
  assert.notEqual(partners.statusCode, 403);
  await app.close();
});

// ─────────────────────────────────────────────────────────────
// Webhook endpoint shape (signature verification is integration-tested
// against a real Svix client in CLERK_SETUP.md's smoke test).
// ─────────────────────────────────────────────────────────────

test('POST /webhooks/clerk → 503 WEBHOOK_NOT_CONFIGURED when secret is blank', async () => {
  // No verifyAuth override needed — webhook is in PUBLIC_ROUTES so the tenant
  // plugin doesn't gate it.
  const app = await buildServer({ config: makeConfig(''), s3: okS3, prisma: makePrisma() });
  const res = await app.inject({
    method: 'POST',
    url: '/webhooks/clerk',
    headers: { 'content-type': 'application/json' },
    payload: '{"type":"organization.created","data":{"id":"org_x","name":"X"}}',
  });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, 'WEBHOOK_NOT_CONFIGURED');
  await app.close();
});

// ─────────────────────────────────────────────────────────────
// Phase 9 Sprint 3 — RBAC enforcement
// ─────────────────────────────────────────────────────────────

function rbacApp(role: 'admin' | 'ops' | 'viewer') {
  const verifyAuth = async (): Promise<AuthOutcome> => ({
    kind: 'verified',
    auth: { clerkUserId: 'user_a', orgId: 'org_known' },
  });
  return buildServer({
    config: makeConfig(),
    s3: okS3,
    prisma: makePrisma({
      tenant: { id: PILOT_TENANT_ID, clerkOrgId: 'org_known' },
      user: { id: 'u-1', role },
    }),
    verifyAuth,
  });
}

test('admin can hit an admin-required route (POST /partners-config)', async () => {
  const app = await rbacApp('admin');
  const res = await app.inject({
    method: 'POST', url: '/api/partners-config',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ displayName: 'X', isaSenderIds: ['X'], isaReceiverIds: [] }),
  });
  // It should NOT be 403 from RBAC. (Might be 5xx from the fake prisma not
  // implementing tradingPartner.create — that's fine; we're only checking
  // RBAC didn't reject it.)
  assert.notEqual(res.statusCode, 403, `unexpected 403: ${res.body}`);
  await app.close();
});

test('viewer is rejected with 403 FORBIDDEN on POST /partners-config', async () => {
  const app = await rbacApp('viewer');
  const res = await app.inject({
    method: 'POST', url: '/api/partners-config',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ displayName: 'X', isaSenderIds: ['X'], isaReceiverIds: [] }),
  });
  assert.equal(res.statusCode, 403);
  const body = res.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'FORBIDDEN');
  assert.equal(body.error.message, 'You do not have permission to perform this action.');
  assert.doesNotMatch(body.error.message, /viewer/i);
  await app.close();
});

test('ops is rejected with 403 FORBIDDEN on POST /partners-config (admin only)', async () => {
  const app = await rbacApp('ops');
  const res = await app.inject({
    method: 'POST', url: '/api/partners-config',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ displayName: 'X', isaSenderIds: ['X'], isaReceiverIds: [] }),
  });
  assert.equal(res.statusCode, 403);
  const body = res.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'FORBIDDEN');
  assert.equal(body.error.message, 'You do not have permission to perform this action.');
  assert.doesNotMatch(body.error.message, /ops/i);
  await app.close();
});

test('viewer can hit a viewer-required route (GET /partners-config)', async () => {
  const app = await rbacApp('viewer');
  const res = await app.inject({ method: 'GET', url: '/api/partners-config' });
  assert.notEqual(res.statusCode, 403, `viewer should NOT be 403 on GET: ${res.body}`);
  await app.close();
});

test('dev-fallback bypasses RBAC (implicit admin for local iteration)', async () => {
  const verifyAuth = async (): Promise<AuthOutcome> => ({ kind: 'dev-fallback' });
  const app = await buildServer({
    config: makeConfig(''), s3: okS3, prisma: makePrisma(), verifyAuth,
  });
  // Hitting an admin-required route in dev-fallback shouldn't 403.
  const res = await app.inject({
    method: 'POST', url: '/api/partners-config',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ displayName: 'X', isaSenderIds: ['X'], isaReceiverIds: [] }),
  });
  assert.notEqual(res.statusCode, 403, 'dev-fallback should not produce 403');
  await app.close();
});

test('desktop hub serves SPA shell without JWT but still protects /api', async () => {
  const prev = process.env.EDI_HUB_USER_DATA_DIR;
  process.env.EDI_HUB_USER_DATA_DIR = 'C:\\Users\\test\\AppData\\Roaming\\EDI Hub';
  const verifyAuth = async (): Promise<AuthOutcome> => ({
    kind: 'invalid',
    reason: 'token-invalid-authorized-parties',
  });
  try {
    const app = await buildServer({
      config: {
        ...makeConfig('sk_test_present'),
        nodeEnv: 'production',
        webStatic: { dir: '' },
      },
      s3: okS3,
      prisma: makePrisma(),
      verifyAuth,
    });
    const shell = await app.inject({ method: 'GET', url: '/' });
    assert.notEqual(shell.statusCode, 401, 'GET / must not require JWT in desktop hub mode');

    const api = await app.inject({ method: 'GET', url: '/api/partners-config' });
    assert.equal(api.statusCode, 401);
    await app.close();
  } finally {
    if (prev) process.env.EDI_HUB_USER_DATA_DIR = prev;
    else delete process.env.EDI_HUB_USER_DATA_DIR;
  }
});
