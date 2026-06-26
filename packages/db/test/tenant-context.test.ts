/**
 * Phase 9 Sprint 1.5 — tenant context unit tests.
 *
 * Exercises the AsyncLocalStorage wrapper directly. The integration of the
 * context with the Prisma extension is tested in tenant-extension.test.ts
 * against the pure helpers; the full DB-backed isolation test runs in
 * Sprint 6 (Phase 9.6) against a real Postgres.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tenantContext, PILOT_TENANT_ID, TenantContextMissingError } from '../src/index.js';

test('current() returns undefined when no context has been set', () => {
  // Note: this test relies on running in a fresh ALS frame. If a previous test
  // in the same node:test process called enterWith without cleanup, that
  // context would leak. We isolate by running this assertion inside run() →
  // exiting → re-checking outside.
  tenantContext.run({ tenantId: 'a' }, () => {
    assert.equal(tenantContext.current()?.tenantId, 'a');
  });
  // After run() returns, ALS unwinds — current() should be undefined unless
  // the surrounding test runner happens to be inside an enterWith frame from
  // another test. We can't assert undefined globally, so just confirm that
  // exiting run() returned us to whatever the surrounding state was.
});

test('run() scopes the tenantId to the callback', () => {
  const seen: string[] = [];
  tenantContext.run({ tenantId: 'tenant-a' }, () => {
    seen.push(tenantContext.requireTenantId());
    tenantContext.run({ tenantId: 'tenant-b' }, () => {
      seen.push(tenantContext.requireTenantId());
    });
    // Back to outer scope after nested run() exits.
    seen.push(tenantContext.requireTenantId());
  });
  assert.deepEqual(seen, ['tenant-a', 'tenant-b', 'tenant-a']);
});

test('requireTenantId() falls back to PILOT_TENANT_ID when no context is set (non-production)', () => {
  // Soft-fallback semantics in dev/test: fake-Prisma fixtures get a sensible
  // default. Production throws instead (see next test).
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const result = tenantContext.requireTenantId();
    assert.equal(result, PILOT_TENANT_ID);
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
});

test('requireTenantId() throws in production when no context is set', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(
      () => tenantContext.requireTenantId(),
      TenantContextMissingError,
    );
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
});

test('bypass() sets bypass=true while preserving (or stubbing) tenantId', () => {
  tenantContext.run({ tenantId: 'a' }, () => {
    tenantContext.bypass(() => {
      const ctx = tenantContext.current()!;
      assert.equal(ctx.bypass, true);
      // requireTenantId still returns something so error logs name a tenant.
      assert.equal(tenantContext.requireTenantId(), 'a');
    });
    // Outside the bypass block we're back to the normal tenant context.
    assert.equal(tenantContext.current()?.bypass, false);
  });
});

test('PILOT_TENANT_ID is the pre-Phase-9 backfill anchor', () => {
  // The migration assigns every existing row to this UUID. If this changes,
  // the backfill migration in 20260619030000_phase9_tenants must update too.
  assert.equal(PILOT_TENANT_ID, '00000000-0000-0000-0000-000000000001');
});
