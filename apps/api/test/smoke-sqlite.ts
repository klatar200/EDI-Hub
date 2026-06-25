/**
 * Desktop track D1 Sprint 4 — SQLite end-to-end round-trip.
 *
 * The existing API test suite (`.test.ts` files) runs entirely against
 * in-memory Prisma fakes and never reaches the database. That means
 * `test:sqlite` proves only that the runner boots under the SQLite env — it
 * cannot surface a SQLite-specific incompatibility. This script closes that
 * gap by exercising the actual SQLite-generated Prisma client against the
 * real on-disk schema.
 *
 * Coverage targets (mapped to D1 sprint exit criteria):
 *   - S4.1 evidence: real SQLite queries complete successfully.
 *   - D1 Sprint 1 audit: every flagged column shape round-trips correctly.
 *     - `@db.Uuid` removed → IDs are plain TEXT, comparisons still work.
 *     - Enums (`RawFileStatus`, `SourceChannel`) read back as the documented
 *       string literals.
 *     - DateTime fields persist + read as Date instances.
 *   - D1 Sprint 3 middleware: the four `String[]` array columns serialize on
 *     write and deserialize on read. Tested via `Tenant.ourIsaIds`,
 *     `TradingPartner.isaSenderIds` / `isaReceiverIds` / `supportedSets`.
 *   - D1 Sprint 3 Option A: `assertNoIsaOverlap` + `resolvePartnerByIsa` run
 *     against real rows without Postgres array operators.
 *   - Phase 9 tenant extension under SQLite: missing-context throws, bypass
 *     works, and a forged cross-tenant probe returns null (not data).
 *   - Phase 9 audit middleware sanity: an AuditEvent insert round-trips.
 *
 * Run via `npm run smoke:sqlite --workspace=@edi/api` (the wrapper handles
 * the migrate-then-run dance).
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';

import {
  getPrisma,
  disconnectPrisma,
  tenantContext,
  resolveProvider,
} from '@edi/db';
import {
  assertNoIsaOverlap,
  resolvePartnerByIsa,
  PartnerConflictError,
} from '../src/services/partners.js';

// Make absolutely sure we're hitting the SQLite client and not someone's
// stray DATABASE_URL pointing at Postgres. The wrapper script sets these,
// but a manual invocation might forget.
if (resolveProvider() !== 'sqlite') {
  throw new Error(
    `[smoke:sqlite] Expected DATABASE_PROVIDER=sqlite, got '${process.env.DATABASE_PROVIDER ?? ''}'. ` +
      'Run via `npm run smoke:sqlite` or set the env vars manually.',
  );
}

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function step(label: string): void {
  // eslint-disable-next-line no-console
  console.log(`[smoke:sqlite] ${label}`);
}

async function main(): Promise<void> {
  const prisma = getPrisma();

  // ─── 1. Tenant bootstrap (exempt model, uses bypass) ───────────────────
  step('1. Bootstrapping two tenants under tenantContext.bypass');
  await tenantContext.bypass(async () => {
    await prisma.tenant.create({
      data: {
        id: TENANT_A,
        displayName: 'Smoke Tenant A',
        ourIsaIds: ['US_ISA_A1', 'US_ISA_A2'],
      },
    });
    await prisma.tenant.create({
      data: {
        id: TENANT_B,
        displayName: 'Smoke Tenant B',
        ourIsaIds: ['US_ISA_B1'],
      },
    });
  });

  // ─── 2. ourIsaIds array round-trip on Tenant ───────────────────────────
  step('2. Verifying Tenant.ourIsaIds round-trips as a JS array');
  const tenantA = await tenantContext.bypass(async () =>
    prisma.tenant.findUnique({ where: { id: TENANT_A } }),
  );
  assert.ok(tenantA, 'tenant A read back null');
  assert.deepEqual(
    tenantA!.ourIsaIds,
    ['US_ISA_A1', 'US_ISA_A2'],
    'ourIsaIds did not round-trip — array-serialization middleware misfired',
  );

  // ─── 3. Missing-context guard fires on a multi-tenant model ────────────
  step('3. Verifying missing-context throws on TradingPartner.findMany');
  await assert.rejects(
    () => prisma.tradingPartner.findMany(),
    /called without a tenant context/,
    'extension did not refuse a multi-tenant query without a context',
  );

  // ─── 4. Create a partner under tenant A, exercising the array fields ──
  step('4. Creating partner under tenant A with all three array columns');
  const partnerAId = randomUUID();
  await tenantContext.run({ tenantId: TENANT_A }, async () => {
    await prisma.tradingPartner.create({
      data: {
        id: partnerAId,
        tenantId: TENANT_A,
        displayName: 'Sysco',
        isaSenderIds: ['SYSCO_SEND'],
        isaReceiverIds: ['US_ISA_A1'],
        supportedSets: ['850', '855', '810'],
      },
    });
  });

  // ─── 5. Partner read-back: all three array fields deserialize correctly ──
  step('5. Reading partner back; verifying all array fields deserialize');
  const partnerARow = await tenantContext.run({ tenantId: TENANT_A }, async () =>
    prisma.tradingPartner.findUnique({ where: { id: partnerAId } }),
  );
  assert.ok(partnerARow, 'partner A read back null');
  assert.deepEqual(partnerARow!.isaSenderIds, ['SYSCO_SEND']);
  assert.deepEqual(partnerARow!.isaReceiverIds, ['US_ISA_A1']);
  assert.deepEqual(partnerARow!.supportedSets, ['850', '855', '810']);

  // ─── 6. Option A: assertNoIsaOverlap throws on a conflicting create ───
  step('6. Verifying assertNoIsaOverlap blocks a conflicting partner');
  await tenantContext.run({ tenantId: TENANT_A }, async () => {
    await assert.rejects(
      () =>
        assertNoIsaOverlap(prisma, {
          displayName: 'Sysco-duplicate',
          isaSenderIds: ['SYSCO_SEND'],
          isaReceiverIds: [],
        }),
      (err: unknown) => err instanceof PartnerConflictError,
      'overlap check did not fire on a conflicting sender ID',
    );
  });

  // ─── 7. Option A: resolvePartnerByIsa returns the correct partner ─────
  step('7. Verifying resolvePartnerByIsa finds the partner by sender ID');
  const resolved = await tenantContext.run({ tenantId: TENANT_A }, async () =>
    resolvePartnerByIsa(prisma, 'SYSCO_SEND', 'US_ISA_A1', ['US_ISA_A1']),
  );
  assert.ok(resolved, 'resolver returned null for a known partner');
  assert.equal(resolved!.displayName, 'Sysco');
  assert.deepEqual(resolved!.isaSenderIds, ['SYSCO_SEND']);

  // ─── 8. Cross-tenant isolation: tenant B cannot see tenant A's partner ─
  step("8. Verifying tenant B's queries don't see tenant A's partner");
  const visibleFromB = await tenantContext.run({ tenantId: TENANT_B }, async () =>
    prisma.tradingPartner.findMany(),
  );
  assert.equal(
    visibleFromB.length,
    0,
    'tenant B leaked tenant A partner rows — tenant extension regression on SQLite',
  );
  const forgedProbe = await tenantContext.run({ tenantId: TENANT_B }, async () =>
    prisma.tradingPartner.findUnique({ where: { id: partnerAId } }),
  );
  assert.equal(
    forgedProbe,
    null,
    'tenant B retrieved tenant A row by id — cross-tenant probe must return null',
  );

  // ─── 9. RawFile CRUD: enum, DateTime, generated UUID id ────────────────
  step('9. Creating a RawFile under tenant A; verifying enum + DateTime');
  const rawFile = await tenantContext.run({ tenantId: TENANT_A }, async () =>
    prisma.rawFile.create({
      data: {
        tenantId: TENANT_A,
        s3Key: `raw/smoke-${Date.now()}.edi`,
        fileHash: 'deadbeef',
        source: 'upload',
        status: 'RECEIVED',
      },
    }),
  );
  assert.ok(rawFile.id, 'raw file id missing');
  assert.equal(rawFile.source, 'upload', 'SourceChannel enum did not round-trip');
  assert.equal(rawFile.status, 'RECEIVED', 'RawFileStatus enum did not round-trip');
  assert.ok(rawFile.ingestedAt instanceof Date, 'ingestedAt is not a Date');

  // ─── 10. Audit event round-trip (Phase 9 Sprint 4 audit table) ────────
  step('10. Inserting an AuditEvent and reading it back');
  await tenantContext.run({ tenantId: TENANT_A }, async () => {
    await prisma.auditEvent.create({
      data: {
        tenantId: TENANT_A,
        action: 'smoke.test',
        targetType: 'rawFile',
        targetId: rawFile.id,
        payloadDiff: { after: { id: rawFile.id } },
      },
    });
    const audit = await prisma.auditEvent.findFirst({
      where: { action: 'smoke.test', targetId: rawFile.id },
    });
    assert.ok(audit, 'audit row read back null');
    assert.deepEqual(audit!.payloadDiff, { after: { id: rawFile.id } });
  });

  // ─── 11. Clean up (best-effort; the wrapper deletes the file anyway) ──
  step('11. Tearing down tenants (cascades to all child rows)');
  await tenantContext.bypass(async () => {
    await prisma.auditEvent.deleteMany({ where: { tenantId: TENANT_A } });
    await prisma.rawFile.deleteMany({ where: { tenantId: TENANT_A } });
    await prisma.tradingPartner.deleteMany({ where: { tenantId: TENANT_A } });
    await prisma.tenant.delete({ where: { id: TENANT_A } });
    await prisma.tenant.delete({ where: { id: TENANT_B } });
  });

  await disconnectPrisma();
  // eslint-disable-next-line no-console
  console.log('\n[smoke:sqlite] all 10 round-trip checks PASSED');
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('\n[smoke:sqlite] FAILED:', err);
  try {
    await disconnectPrisma();
  } catch {
    /* swallow */
  }
  process.exit(1);
});
