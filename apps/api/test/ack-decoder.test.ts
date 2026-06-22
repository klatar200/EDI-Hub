/**
 * Phase 6 Sprint 2 — ack-code override overlay tests.
 *
 * Validates that `applyAckOverrides`:
 *   - returns input unchanged when no overrides are configured
 *   - replaces AK304 / AK403 messages with partner-preferred wording
 *   - never mutates input (immutability guarantee)
 *   - leaves unknown codes alone (pass-through)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAckOverrides, overrideTransactionAck, overrideGroupAck } from '../src/services/ack-decoder.js';
import type { AckCodeOverrides, RejectionSegmentError } from '@edi/shared';

const SAMPLE: RejectionSegmentError[] = [
  {
    segmentTag: 'BEG', segmentPosition: '2', loopIdentifier: '',
    syntaxErrorCode: '8', syntaxErrorMessage: 'Segment Has Data Element Errors',
    elementErrors: [
      {
        elementPosition: '3', dataElementReference: '324',
        syntaxErrorCode: '1', syntaxErrorMessage: 'Mandatory data element missing',
        badValue: '',
      },
    ],
  },
];

test('no overrides -> input passes through unchanged', () => {
  const out = applyAckOverrides(SAMPLE, {});
  assert.equal(out, SAMPLE);
});

test('null details returns null', () => {
  assert.equal(applyAckOverrides(null, { AK304: { '8': 'foo' } }), null);
});

test('partner AK304 override replaces the segment-level message', () => {
  const overrides: AckCodeOverrides = { AK304: { '8': 'Partner-specific phrasing for code 8' } };
  const out = applyAckOverrides(SAMPLE, overrides);
  assert.ok(out);
  assert.equal(out![0]!.syntaxErrorMessage, 'Partner-specific phrasing for code 8');
  // Element-level untouched.
  assert.equal(out![0]!.elementErrors[0]!.syntaxErrorMessage, 'Mandatory data element missing');
});

test('partner AK403 override replaces the element-level message only', () => {
  const overrides: AckCodeOverrides = { AK403: { '1': 'Required by partner X' } };
  const out = applyAckOverrides(SAMPLE, overrides);
  assert.ok(out);
  assert.equal(out![0]!.elementErrors[0]!.syntaxErrorMessage, 'Required by partner X');
  assert.equal(out![0]!.syntaxErrorMessage, 'Segment Has Data Element Errors');
});

test('overrides do not mutate the source array', () => {
  const overrides: AckCodeOverrides = { AK304: { '8': 'mutated?' } };
  const original = JSON.parse(JSON.stringify(SAMPLE)) as RejectionSegmentError[];
  applyAckOverrides(SAMPLE, overrides);
  assert.deepEqual(SAMPLE, original);
});

test('overrides for unmapped codes leave entries alone', () => {
  const overrides: AckCodeOverrides = { AK304: { '99': 'never matches anything in SAMPLE' } };
  const out = applyAckOverrides(SAMPLE, overrides);
  assert.ok(out);
  assert.equal(out![0]!.syntaxErrorMessage, 'Segment Has Data Element Errors');
});

test('overrideTransactionAck / overrideGroupAck return the override or null', () => {
  const overrides: AckCodeOverrides = { AK501: { R: 'Partner-customized reject text' } };
  assert.equal(overrideTransactionAck('R', overrides), 'Partner-customized reject text');
  assert.equal(overrideTransactionAck('A', overrides), null);
  assert.equal(overrideGroupAck('R', overrides), null);
});
