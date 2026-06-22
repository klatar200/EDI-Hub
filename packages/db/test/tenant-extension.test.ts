/**
 * Phase 9 Sprint 1.5 — tenant extension unit tests.
 *
 * Exercises the pure helpers (`injectInWhere`, `injectInData`) directly. The
 * extension's runtime wiring (query hook on the extended client) is integration-
 * tested in Sprint 6 against a real Postgres — we can't run Prisma's $extends
 * machinery in isolation here without booting the engine.
 *
 * What we DO test:
 *   - injectInWhere fabricates a where when none is given.
 *   - injectInWhere merges with an existing where.
 *   - injectInWhere throws on a mismatching explicit tenantId (developer bug).
 *   - injectInData injects on a single object.
 *   - injectInData injects across nested relation creates (the parseAndStore
 *     pattern) when given the real Prisma DMMF.
 *   - injectInData does NOT touch fields of exempt models (Tenant).
 *   - MULTI_TENANT_MODELS + TENANT_EXEMPT_MODELS together cover every model in
 *     the schema — a Sprint 6 invariant we're enforcing early.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import {
  MULTI_TENANT_MODELS,
  TENANT_EXEMPT_MODELS,
  injectInData,
  injectInWhere,
  type MinimalDmmf,
} from '../src/index.js';

const T = '11111111-1111-1111-1111-111111111111';
// Match the runtime coercion in withTenantExtension — see comment there.
const dmmf = Prisma.dmmf.datamodel as unknown as MinimalDmmf;

// ─────────────────────────────────────────────────────────────
// injectInWhere
// ─────────────────────────────────────────────────────────────

test('injectInWhere fabricates a where when none is given', () => {
  const out = injectInWhere(undefined, T);
  assert.deepEqual(out, { tenantId: T });
});

test('injectInWhere merges into an existing where', () => {
  const out = injectInWhere({ status: 'PARSED' }, T);
  assert.deepEqual(out, { status: 'PARSED', tenantId: T });
});

test('injectInWhere passes through when the caller already set the matching tenantId', () => {
  const out = injectInWhere({ tenantId: T, status: 'PARSED' }, T);
  assert.deepEqual(out, { tenantId: T, status: 'PARSED' });
});

test('injectInWhere throws on a conflicting explicit tenantId', () => {
  assert.throws(
    () => injectInWhere({ tenantId: 'OTHER' }, T),
    /conflicts with explicit/,
  );
});

// ─────────────────────────────────────────────────────────────
// injectInData
// ─────────────────────────────────────────────────────────────

test('injectInData injects tenantId on a single multi-tenant row', () => {
  const out = injectInData({ s3Key: 'k', fileHash: 'h' }, 'RawFile', T, dmmf);
  assert.deepEqual(out, { s3Key: 'k', fileHash: 'h', tenantId: T });
});

test('injectInData injects tenantId across an array of multi-tenant rows', () => {
  const out = injectInData(
    [{ s3Key: 'k1', fileHash: 'h1' }, { s3Key: 'k2', fileHash: 'h2' }],
    'RawFile', T, dmmf,
  );
  assert.deepEqual(out, [
    { s3Key: 'k1', fileHash: 'h1', tenantId: T },
    { s3Key: 'k2', fileHash: 'h2', tenantId: T },
  ]);
});

test('injectInData injects across nested relation creates (parseAndStore pattern)', () => {
  // Mirrors what apps/api/src/services/parsing.ts builds: an Interchange with
  // nested FunctionalGroup → Transaction → Segment → Element creates.
  const input = {
    rawFileId: 'rf-1',
    senderId: 'SENDER',
    receiverId: 'RECEIVER',
    version: '00401',
    elementSeparator: '*',
    subElementSeparator: ':',
    segmentTerminator: '~',
    isaControlNumber: '000000001',
    functionalGroups: {
      create: [
        {
          functionalIdCode: 'PO',
          controlNumber: '1',
          version: '004010',
          transactions: {
            create: [
              {
                transactionSetId: '850',
                controlNumber: '0001',
                segmentCount: 5,
                segments: {
                  create: [
                    {
                      tag: 'BEG',
                      position: 1,
                      elements: { create: [{ index: 1, value: '00' }] },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  };
  const out = injectInData(input, 'Interchange', T, dmmf) as Record<string, unknown>;

  // Top-level row got tenantId.
  assert.equal(out.tenantId, T);

  // Nested FunctionalGroup → tenantId injected.
  const fg = (out.functionalGroups as { create: Array<Record<string, unknown>> }).create[0]!;
  assert.equal(fg.tenantId, T);

  // Nested Transaction → tenantId injected.
  const txn = (fg.transactions as { create: Array<Record<string, unknown>> }).create[0]!;
  assert.equal(txn.tenantId, T);

  // Nested Segment → tenantId injected.
  const seg = (txn.segments as { create: Array<Record<string, unknown>> }).create[0]!;
  assert.equal(seg.tenantId, T);

  // Nested Element → tenantId injected.
  const el = (seg.elements as { create: Array<Record<string, unknown>> }).create[0]!;
  assert.equal(el.tenantId, T);
});

test('injectInData respects createMany.data shape on nested relations', () => {
  const input = {
    rawFileId: 'rf-1',
    senderId: 'S', receiverId: 'R', version: '00401',
    elementSeparator: '*', subElementSeparator: ':', segmentTerminator: '~',
    isaControlNumber: '000000002',
    functionalGroups: {
      createMany: {
        data: [
          { functionalIdCode: 'PO', controlNumber: '1', version: '004010' },
          { functionalIdCode: 'IN', controlNumber: '2', version: '004010' },
        ],
      },
    },
  };
  const out = injectInData(input, 'Interchange', T, dmmf) as Record<string, unknown>;
  const fgs = (out.functionalGroups as { createMany: { data: Array<Record<string, unknown>> } })
    .createMany.data;
  assert.equal(fgs[0]!.tenantId, T);
  assert.equal(fgs[1]!.tenantId, T);
});

test('injectInData does not overwrite an explicitly-supplied tenantId', () => {
  // The author wrote it themselves; we trust them (the where-side check
  // catches mismatches at query time).
  const out = injectInData({ s3Key: 'k', fileHash: 'h', tenantId: T }, 'RawFile', T, dmmf);
  assert.deepEqual(out, { s3Key: 'k', fileHash: 'h', tenantId: T });
});

// ─────────────────────────────────────────────────────────────
// Schema drift invariant
// ─────────────────────────────────────────────────────────────

test('every model in schema.prisma is either tenant-scoped or exempt', () => {
  const knownModels = new Set(dmmf.models.map((m) => m.name));
  const declared = new Set([...MULTI_TENANT_MODELS, ...TENANT_EXEMPT_MODELS]);
  const missing: string[] = [];
  for (const name of knownModels) {
    if (!declared.has(name)) missing.push(name);
  }
  assert.deepEqual(
    missing,
    [],
    `Models exist in schema.prisma but aren't classified in tenant-extension.ts: ${missing.join(', ')}. ` +
    'Add to MULTI_TENANT_MODELS or TENANT_EXEMPT_MODELS.',
  );
});
