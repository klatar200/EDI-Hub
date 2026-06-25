/**
 * Desktop track D1 Sprint 3 — array-serialization helper unit tests.
 *
 * Direct unit tests on the pure helpers (`serializeArrayFields`,
 * `deserializeArrayFields`, `ARRAY_FIELDS_BY_MODEL`). The integration with
 * the tenant extension (provider gating, end-to-end through Prisma's
 * `$extends`) is covered indirectly by:
 *   - the existing Postgres-side tests still passing unchanged (S3.3 — no
 *     transformation occurs on Postgres), and
 *   - the D1 Sprint 4 SQLite test-suite run against the API (S3.1 / S3.2 —
 *     arrays round-trip through real query operations).
 *
 * Mirrors the pattern in `tenant-extension.test.ts` — small, fast, no Prisma
 * client instantiation needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARRAY_FIELDS_BY_MODEL,
  serializeArrayFields,
  deserializeArrayFields,
} from '../src/array-serialization.js';
import { resolveProvider } from '../src/provider.js';

// ─────────────────────────────────────────────────────────────
// Documented field map
// ─────────────────────────────────────────────────────────────

test('ARRAY_FIELDS_BY_MODEL covers the exact four documented columns', () => {
  assert.deepEqual(Object.keys(ARRAY_FIELDS_BY_MODEL).sort(), ['Tenant', 'TradingPartner']);
  assert.deepEqual([...ARRAY_FIELDS_BY_MODEL.Tenant!], ['ourIsaIds']);
  assert.deepEqual(
    [...ARRAY_FIELDS_BY_MODEL.TradingPartner!],
    ['isaSenderIds', 'isaReceiverIds', 'supportedSets'],
  );
});

// ─────────────────────────────────────────────────────────────
// serializeArrayFields — S3.1
// ─────────────────────────────────────────────────────────────

test('serializeArrayFields stringifies ourIsaIds on Tenant', () => {
  const out = serializeArrayFields('Tenant', {
    displayName: 'Acme',
    ourIsaIds: ['ABC', 'XYZ'],
  }) as Record<string, unknown>;
  assert.equal(out.ourIsaIds, '["ABC","XYZ"]');
  // Unrelated fields untouched.
  assert.equal(out.displayName, 'Acme');
});

test('serializeArrayFields stringifies all three TradingPartner array fields', () => {
  const out = serializeArrayFields('TradingPartner', {
    displayName: 'Acme',
    isaSenderIds: ['S1', 'S2'],
    isaReceiverIds: ['R1'],
    supportedSets: ['850', '855'],
  }) as Record<string, unknown>;
  assert.equal(out.isaSenderIds, '["S1","S2"]');
  assert.equal(out.isaReceiverIds, '["R1"]');
  assert.equal(out.supportedSets, '["850","855"]');
  assert.equal(out.displayName, 'Acme');
});

test('serializeArrayFields handles Prisma update { set: [...] } form', () => {
  const out = serializeArrayFields('Tenant', {
    ourIsaIds: { set: ['A', 'B'] },
  }) as Record<string, unknown>;
  assert.equal(out.ourIsaIds, '["A","B"]');
});

test('serializeArrayFields walks createMany.data arrays', () => {
  const out = serializeArrayFields('Tenant', [
    { ourIsaIds: ['A'] },
    { ourIsaIds: ['B'] },
  ]) as Array<Record<string, unknown>>;
  assert.equal(out[0]!.ourIsaIds, '["A"]');
  assert.equal(out[1]!.ourIsaIds, '["B"]');
});

test('serializeArrayFields does not mutate the input object', () => {
  const input = { ourIsaIds: ['A', 'B'] };
  serializeArrayFields('Tenant', input);
  assert.deepEqual(input.ourIsaIds, ['A', 'B']);
});

test('serializeArrayFields is a no-op for models without array fields', () => {
  const input = { ourIsaIds: ['ABC'] };
  const out = serializeArrayFields('Alert', input) as Record<string, unknown>;
  // `Alert` has no array columns; the field passes through as-is.
  assert.deepEqual(out.ourIsaIds, ['ABC']);
});

test('serializeArrayFields passes through null / undefined / primitives', () => {
  assert.equal(serializeArrayFields('Tenant', null), null);
  assert.equal(serializeArrayFields('Tenant', undefined), undefined);
  assert.equal(serializeArrayFields('Tenant', 42), 42);
  assert.equal(serializeArrayFields('Tenant', 'string'), 'string');
});

test('serializeArrayFields preserves non-array values on array fields (no double-encode)', () => {
  // Already JSON-encoded — should NOT re-encode.
  const out = serializeArrayFields('Tenant', {
    ourIsaIds: '["A","B"]',
  }) as Record<string, unknown>;
  assert.equal(out.ourIsaIds, '["A","B"]');
});

// ─────────────────────────────────────────────────────────────
// deserializeArrayFields — S3.2
// ─────────────────────────────────────────────────────────────

test('deserializeArrayFields parses ourIsaIds back to an array', () => {
  const out = deserializeArrayFields('Tenant', {
    displayName: 'Acme',
    ourIsaIds: '["ABC","XYZ"]',
  }) as Record<string, unknown>;
  assert.deepEqual(out.ourIsaIds, ['ABC', 'XYZ']);
  assert.equal(out.displayName, 'Acme');
});

test('deserializeArrayFields parses all three TradingPartner array fields', () => {
  const out = deserializeArrayFields('TradingPartner', {
    isaSenderIds: '["S1"]',
    isaReceiverIds: '["R1","R2"]',
    supportedSets: '["850","855","997"]',
  }) as Record<string, unknown>;
  assert.deepEqual(out.isaSenderIds, ['S1']);
  assert.deepEqual(out.isaReceiverIds, ['R1', 'R2']);
  assert.deepEqual(out.supportedSets, ['850', '855', '997']);
});

test('deserializeArrayFields handles findMany array results', () => {
  const out = deserializeArrayFields('Tenant', [
    { ourIsaIds: '["A"]' },
    { ourIsaIds: '["B","C"]' },
  ]) as Array<Record<string, unknown>>;
  assert.deepEqual(out[0]!.ourIsaIds, ['A']);
  assert.deepEqual(out[1]!.ourIsaIds, ['B', 'C']);
});

test('deserializeArrayFields handles findUnique miss (null result)', () => {
  assert.equal(deserializeArrayFields('Tenant', null), null);
});

test('deserializeArrayFields handles count result (number)', () => {
  assert.equal(deserializeArrayFields('Tenant', 7), 7);
});

test('deserializeArrayFields leaves non-JSON strings untouched (loud failure)', () => {
  const out = deserializeArrayFields('Tenant', {
    ourIsaIds: 'not-json',
  }) as Record<string, unknown>;
  assert.equal(out.ourIsaIds, 'not-json');
});

test('deserializeArrayFields leaves valid JSON non-arrays untouched', () => {
  // A scalar JSON string like '"hello"' is valid JSON but not an array — leave
  // it so the test/log shows a real "expected array" error downstream.
  const out = deserializeArrayFields('Tenant', {
    ourIsaIds: '"not-an-array"',
  }) as Record<string, unknown>;
  assert.equal(out.ourIsaIds, '"not-an-array"');
});

test('deserializeArrayFields is a no-op for models without array fields', () => {
  const input = { ourIsaIds: '["A"]' };
  const out = deserializeArrayFields('Alert', input) as Record<string, unknown>;
  assert.equal(out.ourIsaIds, '["A"]');
});

// ─────────────────────────────────────────────────────────────
// Provider gate — S3.3 (Postgres no-op)
// ─────────────────────────────────────────────────────────────
//
// The tenant extension checks `resolveProvider() === 'sqlite'` at construction
// time. If the env is unset or 'postgresql', the extension never invokes the
// helpers — confirmed here by asserting the resolver's decision. Live runtime
// gating is exercised end-to-end in D1 Sprint 4.

test('resolveProvider gates the helpers off on Postgres (default)', () => {
  assert.equal(resolveProvider({}), 'postgresql');
  assert.equal(resolveProvider({ DATABASE_PROVIDER: 'postgresql' }), 'postgresql');
});

test('resolveProvider activates the helpers on SQLite', () => {
  assert.equal(resolveProvider({ DATABASE_PROVIDER: 'sqlite' }), 'sqlite');
});

// ─────────────────────────────────────────────────────────────
// Round-trip
// ─────────────────────────────────────────────────────────────

test('serialize → deserialize round-trips for Tenant.ourIsaIds', () => {
  const original = { ourIsaIds: ['ABC', 'XYZ'] };
  const serialized = serializeArrayFields('Tenant', original) as Record<string, unknown>;
  const deserialized = deserializeArrayFields('Tenant', serialized) as Record<string, unknown>;
  assert.deepEqual(deserialized.ourIsaIds, ['ABC', 'XYZ']);
});

test('serialize → deserialize round-trips for all TradingPartner array fields', () => {
  const original = {
    isaSenderIds: ['S1'],
    isaReceiverIds: ['R1', 'R2'],
    supportedSets: ['850', '855'],
  };
  const serialized = serializeArrayFields('TradingPartner', original) as Record<
    string,
    unknown
  >;
  const deserialized = deserializeArrayFields('TradingPartner', serialized) as Record<
    string,
    unknown
  >;
  assert.deepEqual(deserialized.isaSenderIds, ['S1']);
  assert.deepEqual(deserialized.isaReceiverIds, ['R1', 'R2']);
  assert.deepEqual(deserialized.supportedSets, ['850', '855']);
});

test('round-trip preserves empty arrays', () => {
  const serialized = serializeArrayFields('Tenant', { ourIsaIds: [] }) as Record<
    string,
    unknown
  >;
  assert.equal(serialized.ourIsaIds, '[]');
  const deserialized = deserializeArrayFields('Tenant', serialized) as Record<
    string,
    unknown
  >;
  assert.deepEqual(deserialized.ourIsaIds, []);
});
