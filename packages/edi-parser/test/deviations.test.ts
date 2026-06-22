import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeInterchange, validateTransaction, interpretTransaction } from '../src/index.js';

function isa(isa13: string, version = '00401'): string {
  const e = '*';
  return [
    'ISA', '00', ' '.repeat(10), '00', ' '.repeat(10), 'ZZ', 'SENDER'.padEnd(15),
    'ZZ', 'RECEIVER'.padEnd(15), '260101', '1200', 'U', version, isa13, '0', 'P',
  ].join(e) + e + ':' + '~';
}
const firstTxn = (raw: string) => decomposeInterchange(raw).interchange.groups[0]!.transactions[0]!;

test('preserves proprietary Z-segments in the generic tree', () => {
  const raw = isa('000000001') + 'GS*PO*S*R*20260101*1200*1*X*004010~' +
    ['ST*850*0001', 'BEG*00*SA*PO-1**20260101', 'ZZ*custom*payload', 'SE*4*0001'].join('~') + '~GE*1*1~IEA*1*000000001~';
  const t = firstTxn(raw);
  const z = t.segments.find((s) => s.tag === 'ZZ');
  assert.ok(z, 'Z-segment preserved');
  assert.equal(z.elements[0]!.value, 'custom');
});

test('captures repeated "non-repeating" segments', () => {
  const raw = isa('000000002') + 'GS*PO*S*R*20260101*1200*1*X*004010~' +
    ['ST*850*0001', 'BEG*00*SA*PO-1**20260101', 'REF*DP*001', 'REF*IA*VENDOR', 'SE*5*0001'].join('~') + '~GE*1*1~IEA*1*000000002~';
  const t = firstTxn(raw);
  assert.equal(t.segments.filter((s) => s.tag === 'REF').length, 2);
});

test('tolerates missing optional segments', () => {
  // 850 with only BEG + a line item, no REF/DTM/N1
  const raw = isa('000000003') + 'GS*PO*S*R*20260101*1200*1*X*004010~' +
    ['ST*850*0001', 'BEG*00*SA*PO-9**20260101', 'PO1*1*1*EA*1.00**VP*X', 'SE*4*0001'].join('~') + '~GE*1*1~IEA*1*000000003~';
  const interp = interpretTransaction(firstTxn(raw));
  assert.equal(interp.type, '850');
  if (interp.type === '850') assert.equal(interp.poNumber, 'PO-9');
  assert.deepEqual(validateTransaction(firstTxn(raw)).filter((i) => i.severity === 'error'), []);
});

test('preserves trailing empty elements', () => {
  const raw = isa('000000004') + 'GS*PO*S*R*20260101*1200*1*X*004010~' +
    ['ST*850*0001', 'BEG*00*SA*PO-1**', 'SE*3*0001'].join('~') + '~GE*1*1~IEA*1*000000004~';
  const beg = firstTxn(raw).segments.find((s) => s.tag === 'BEG')!;
  // BEG*00*SA*PO-1** -> elements 00, SA, PO-1, '', ''
  assert.equal(beg.elements.length, 5);
  assert.equal(beg.elements[3]!.value, '');
  assert.equal(beg.elements[4]!.value, '');
});

test('handles CRLF-wrapped segments', () => {
  const body = ['ST*850*0001', 'BEG*00*SA*PO-1**20260101', 'SE*3*0001'].join('~\r\n') + '~\r\n';
  const raw = isa('000000005') + '\r\n' + 'GS*PO*S*R*20260101*1200*1*X*004010~\r\n' + body + 'GE*1*1~\r\nIEA*1*000000005~\r\n';
  const t = firstTxn(raw);
  assert.equal(t.transactionSetId, '850');
  assert.deepEqual(t.segments.map((s) => s.tag), ['ST', 'BEG', 'SE']);
});

test('surfaces the 5010 version from GS08', () => {
  const raw = isa('000000006', '00501') + 'GS*PO*S*R*20260101*1200*1*X*005010~' +
    ['ST*850*0001', 'BEG*00*SA*PO-1**20260101', 'SE*3*0001'].join('~') + '~GE*1*1~IEA*1*000000006~';
  const g = decomposeInterchange(raw).interchange.groups[0]!;
  assert.equal(g.version, '005010');
});

test('validateTransaction flags an 850 missing its PO number as an error', () => {
  const raw = isa('000000007') + 'GS*PO*S*R*20260101*1200*1*X*004010~' +
    ['ST*850*0001', 'BEG*00*SA***20260101', 'PO1*1*1*EA*1.00**VP*X', 'SE*4*0001'].join('~') + '~GE*1*1~IEA*1*000000007~';
  const issues = validateTransaction(firstTxn(raw));
  assert.ok(issues.some((i) => i.severity === 'error' && i.message.includes('Purchase Order Number')));
});

test('validateTransaction flags an 810 missing its invoice number', () => {
  const raw = isa('000000008') + 'GS*IN*S*R*20260101*1200*1*X*004010~' +
    ['ST*810*0001', 'BIG*20260201**20260115*PO-1', 'IT1*1*1*EA*1.00**VP*X', 'SE*4*0001'].join('~') + '~GE*1*1~IEA*1*000000008~';
  const issues = validateTransaction(firstTxn(raw));
  assert.ok(issues.some((i) => i.severity === 'error' && i.message.includes('Invoice Number')));
});

test('a clean 850 produces no error-severity issues', () => {
  const raw = isa('000000009') + 'GS*PO*S*R*20260101*1200*1*X*004010~' +
    ['ST*850*0001', 'BEG*00*SA*PO-1**20260101', 'PO1*1*1*EA*1.00**VP*X', 'SE*4*0001'].join('~') + '~GE*1*1~IEA*1*000000009~';
  assert.deepEqual(validateTransaction(firstTxn(raw)).filter((i) => i.severity === 'error'), []);
});
