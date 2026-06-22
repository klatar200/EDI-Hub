/**
 * X12 acknowledgment-code dictionary tests.
 * Confirms every documented code resolves to the X12 spec wording and unknown
 * codes return null (the caller is responsible for any fallback string).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AK304_SEGMENT_SYNTAX,
  AK403_ELEMENT_SYNTAX,
  AK501_TRANSACTION_ACK,
  AK901_GROUP_ACK,
  decodeElementSyntaxError,
  decodeGroupAckCode,
  decodeSegmentSyntaxError,
  decodeTransactionAckCode,
  describeOrUnknown,
} from '../src/index.js';

test('AK304 segment-syntax dictionary covers codes 1–8 with X12 wording', () => {
  const expected: Record<string, string> = {
    '1': 'Unrecognized segment ID',
    '2': 'Unexpected segment',
    '3': 'Required Segment Missing',
    '4': 'Loop Occurs Over Maximum Times',
    '5': 'Segment Exceeds Maximum Use',
    '6': 'Segment Not in Defined Transaction Set',
    '7': 'Segment Not in Proper Sequence',
    '8': 'Segment Has Data Element Errors',
  };
  for (const [code, message] of Object.entries(expected)) {
    assert.equal(AK304_SEGMENT_SYNTAX[code], message);
    assert.equal(decodeSegmentSyntaxError(code), message);
  }
});

test('AK403 element-syntax dictionary covers codes 1–13 (skipping reserved 11)', () => {
  const codes = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '13'];
  for (const code of codes) {
    assert.ok(AK403_ELEMENT_SYNTAX[code], `missing dictionary entry for AK403=${code}`);
    assert.equal(decodeElementSyntaxError(code), AK403_ELEMENT_SYNTAX[code]);
  }
  // 11 is reserved/unused per the X12 spec.
  assert.equal(decodeElementSyntaxError('11'), null);
});

test('AK501 + AK901 share the X12 ack-code set (A/E/M/P/R/W/X)', () => {
  const codes = ['A', 'E', 'M', 'P', 'R', 'W', 'X'];
  for (const code of codes) {
    assert.ok(AK501_TRANSACTION_ACK[code]);
    assert.equal(decodeTransactionAckCode(code), AK501_TRANSACTION_ACK[code]);
    assert.equal(decodeGroupAckCode(code), AK901_GROUP_ACK[code]);
  }
  assert.equal(decodeTransactionAckCode('A'), 'Accepted');
  assert.equal(decodeGroupAckCode('R'), 'Rejected');
});

test('unknown codes return null from every decoder', () => {
  assert.equal(decodeSegmentSyntaxError('99'), null);
  assert.equal(decodeElementSyntaxError('99'), null);
  assert.equal(decodeTransactionAckCode('Z'), null);
  assert.equal(decodeGroupAckCode('Z'), null);
});

test('describeOrUnknown surfaces a usable fallback for unknown codes', () => {
  assert.equal(
    describeOrUnknown('AK501', 'A', decodeTransactionAckCode),
    'Accepted',
  );
  assert.equal(
    describeOrUnknown('AK501', 'Z', decodeTransactionAckCode),
    'AK501: unknown code "Z"',
  );
  assert.equal(
    describeOrUnknown('AK501', '', decodeTransactionAckCode),
    'AK501: (no code)',
  );
});
