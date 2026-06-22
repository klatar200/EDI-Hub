import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEnvelopeIds, EdiParseError, type Delimiters } from '../src/index.js';

/**
 * Build a spec-length (106-char ISA) interchange for arbitrary delimiters, so
 * the tests prove delimiter auto-detection rather than hardcoded characters.
 */
function buildInterchange(
  d: Delimiters,
  opts: { isa13?: string; sender?: string; receiver?: string; gs06?: string } = {},
): string {
  const { isa13 = '000000001', sender = 'SENDER', receiver = 'RECEIVER', gs06 = '1' } = opts;
  const e = d.element;
  const isaEls = [
    'ISA', '00', ' '.repeat(10), '00', ' '.repeat(10), 'ZZ', sender.padEnd(15),
    'ZZ', receiver.padEnd(15), '260101', '1200', 'U', '00401', isa13, '0', 'P',
  ];
  const isa = isaEls.join(e) + e + d.subElement + d.segment;
  const gs = ['GS', 'PO', 'SENDER', 'RECEIVER', '20260101', '1200', gs06, 'X', '004010'].join(e) + d.segment;
  const st = ['ST', '850', '0001'].join(e) + d.segment;
  const se = ['SE', '2', '0001'].join(e) + d.segment;
  return isa + gs + st + se;
}

test('standard delimiters (* ~ :)', () => {
  const d: Delimiters = { element: '*', subElement: ':', segment: '~' };
  const ids = extractEnvelopeIds(buildInterchange(d));
  assert.equal(ids.isaControlNumber, '000000001');
  assert.equal(ids.gsControlNumber, '1');
  assert.equal(ids.senderId, 'SENDER');
  assert.equal(ids.receiverId, 'RECEIVER');
  assert.deepEqual(ids.delimiters, d);
});

test('pipe element, newline segment, gt sub-element (| \\n >)', () => {
  const d: Delimiters = { element: '|', subElement: '>', segment: '\n' };
  const ids = extractEnvelopeIds(buildInterchange(d, { isa13: '000004242', gs06: '77' }));
  assert.equal(ids.isaControlNumber, '000004242');
  assert.equal(ids.gsControlNumber, '77');
  assert.equal(ids.delimiters.element, '|');
  assert.equal(ids.delimiters.segment, '\n');
});

test('caret element with record-separator terminator', () => {
  const d: Delimiters = { element: '^', subElement: '<', segment: '' };
  const ids = extractEnvelopeIds(buildInterchange(d, { sender: 'ACME', receiver: 'GLOBEX' }));
  assert.equal(ids.isaControlNumber, '000000001');
  assert.equal(ids.senderId, 'ACME');
  assert.equal(ids.receiverId, 'GLOBEX');
});

test('tolerates leading whitespace and CRLF line endings', () => {
  const d: Delimiters = { element: '*', subElement: ':', segment: '~' };
  const raw = '\r\n' + buildInterchange(d).split('~').join('~\r\n');
  const ids = extractEnvelopeIds(raw);
  assert.equal(ids.isaControlNumber, '000000001');
  assert.equal(ids.gsControlNumber, '1');
});

test('interchange with no GS yields empty gsControlNumber', () => {
  const isaEls = [
    'ISA', '00', ' '.repeat(10), '00', ' '.repeat(10), 'ZZ', 'SENDER'.padEnd(15),
    'ZZ', 'RECEIVER'.padEnd(15), '260101', '1200', 'U', '00401', '000000009', '0', 'P',
  ];
  const isaOnly = isaEls.join('*') + '*' + ':' + '~';
  const ids = extractEnvelopeIds(isaOnly);
  assert.equal(ids.isaControlNumber, '000000009');
  assert.equal(ids.gsControlNumber, '');
});

test('rejects empty input as NOT_X12', () => {
  assert.throws(() => extractEnvelopeIds(''), (e: unknown) => e instanceof EdiParseError && e.kind === 'NOT_X12');
});

test('rejects non-X12 input (e.g. a PDF dropped by mistake) as NOT_X12', () => {
  assert.throws(
    () => extractEnvelopeIds('%PDF-1.7\n%binary junk that is not edi at all here'),
    (e: unknown) => e instanceof EdiParseError && e.kind === 'NOT_X12',
  );
});

test('rejects a truncated ISA segment as MALFORMED', () => {
  assert.throws(
    () => extractEnvelopeIds('ISA*00*  *00*'),
    (e: unknown) => e instanceof EdiParseError && e.kind === 'MALFORMED',
  );
});
