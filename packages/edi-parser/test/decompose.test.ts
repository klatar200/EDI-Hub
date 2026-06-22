import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeInterchange, tokenize, EdiParseError } from '../src/index.js';

/** Build a fixed-width (106-char) ISA for the standard `*`/`:`/`~` delimiters. */
function isa(isa13: string): string {
  const e = '*';
  return [
    'ISA', '00', ' '.repeat(10), '00', ' '.repeat(10), 'ZZ', 'SENDER'.padEnd(15),
    'ZZ', 'RECEIVER'.padEnd(15), '260101', '1200', 'U', '00401', isa13, '0', 'P',
  ].join(e) + e + ':' + '~';
}

const PO850 = [
  'ST*850*0001',
  'BEG*00*SA*PO-1**20260101',
  'PO1*1*10*EA*25.00**VP*V1',
  'CTT*1',
  'SE*5*0001',
].join('~') + '~';

test('decomposes a single 850 into the full envelope tree', () => {
  const raw = isa('000000123') + 'GS*PO*SENDER*RECEIVER*20260101*1200*1*X*004010~' + PO850 + 'GE*1*1~IEA*1*000000123~';
  const { interchange, warnings } = decomposeInterchange(raw);

  assert.equal(warnings.length, 0, `unexpected warnings: ${warnings.join('; ')}`);
  assert.equal(interchange.isaControlNumber, '000000123');
  assert.equal(interchange.senderId, 'SENDER');
  assert.equal(interchange.receiverId, 'RECEIVER');
  assert.equal(interchange.declaredGroupCount, 1);
  assert.equal(interchange.groups.length, 1);

  const g = interchange.groups[0]!;
  assert.equal(g.functionalIdCode, 'PO');
  assert.equal(g.controlNumber, '1');
  assert.equal(g.version, '004010');
  assert.equal(g.declaredTransactionCount, 1);
  assert.equal(g.transactions.length, 1);

  const t = g.transactions[0]!;
  assert.equal(t.transactionSetId, '850');
  assert.equal(t.controlNumber, '0001');
  assert.equal(t.declaredSegmentCount, 5);
  assert.equal(t.segmentCount, 5);
  assert.deepEqual(t.segments.map((s) => s.tag), ['ST', 'BEG', 'PO1', 'CTT', 'SE']);

  const beg = t.segments.find((s) => s.tag === 'BEG')!;
  assert.deepEqual(beg.elements, [
    { index: 1, value: '00' },
    { index: 2, value: 'SA' },
    { index: 3, value: 'PO-1' },
    { index: 4, value: '' },
    { index: 5, value: '20260101' },
  ]);
});

test('handles a batched interchange (two transactions in one group)', () => {
  const t1 = ['ST*850*0001', 'BEG*00*SA*PO-1**20260101', 'SE*3*0001'].join('~') + '~';
  const t2 = ['ST*850*0002', 'BEG*00*SA*PO-2**20260102', 'SE*3*0002'].join('~') + '~';
  const raw = isa('000000200') + 'GS*PO*SENDER*RECEIVER*20260101*1200*1*X*004010~' + t1 + t2 + 'GE*2*1~IEA*1*000000200~';
  const { interchange, warnings } = decomposeInterchange(raw);

  assert.equal(warnings.length, 0, warnings.join('; '));
  assert.equal(interchange.groups[0]!.transactions.length, 2);
  assert.deepEqual(interchange.groups[0]!.transactions.map((t) => t.controlNumber), ['0001', '0002']);
});

test('handles multiple functional groups in one interchange', () => {
  const g1 = 'GS*PO*SENDER*RECEIVER*20260101*1200*1*X*004010~' + ['ST*850*0001', 'BEG*00*SA*PO-1**20260101', 'SE*3*0001'].join('~') + '~GE*1*1~';
  const g2 = 'GS*IN*SENDER*RECEIVER*20260101*1200*2*X*004010~' + ['ST*810*0001', 'BIG*20260101*INV-1', 'SE*3*0001'].join('~') + '~GE*1*2~';
  const raw = isa('000000300') + g1 + g2 + 'IEA*2*000000300~';
  const { interchange, warnings } = decomposeInterchange(raw);

  assert.equal(warnings.length, 0, warnings.join('; '));
  assert.equal(interchange.groups.length, 2);
  assert.equal(interchange.groups[0]!.functionalIdCode, 'PO');
  assert.equal(interchange.groups[1]!.functionalIdCode, 'IN');
  assert.equal(interchange.groups[1]!.transactions[0]!.transactionSetId, '810');
});

test('flags a SE segment-count mismatch as a warning (not a throw)', () => {
  const badTxn = ['ST*850*0001', 'BEG*00*SA*PO-1**20260101', 'SE*99*0001'].join('~') + '~';
  const raw = isa('000000400') + 'GS*PO*SENDER*RECEIVER*20260101*1200*1*X*004010~' + badTxn + 'GE*1*1~IEA*1*000000400~';
  const { warnings } = decomposeInterchange(raw);
  assert.ok(warnings.some((w) => w.includes('SE01 segment count')), `expected SE count warning, got: ${warnings.join('; ')}`);
});

test('flags an IEA group-count mismatch as a warning', () => {
  const raw = isa('000000500') + 'GS*PO*SENDER*RECEIVER*20260101*1200*1*X*004010~' + ['ST*850*0001', 'SE*2*0001'].join('~') + '~GE*1*1~IEA*9*000000500~';
  const { warnings } = decomposeInterchange(raw);
  assert.ok(warnings.some((w) => w.includes('IEA01 group count')), warnings.join('; '));
});

test('tokenize exposes raw segments with detected delimiters', () => {
  const raw = isa('000000600') + 'GS*PO*S*R*20260101*1200*1*X*004010~ST*850*0001~SE*2*0001~GE*1*1~IEA*1*000000600~';
  const { delimiters, segments } = tokenize(raw);
  assert.equal(delimiters.element, '*');
  assert.equal(delimiters.segment, '~');
  assert.equal(segments[0]!.tag, 'ISA');
  assert.ok(segments.some((s) => s.tag === 'GS'));
});

test('throws on input that does not begin with ISA', () => {
  assert.throws(() => decomposeInterchange('GS*PO*S*R~ST*850*0001~'), EdiParseError);
});
