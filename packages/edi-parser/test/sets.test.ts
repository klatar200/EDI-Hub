import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decomposeInterchange,
  interpretTransaction,
  extractBusinessKeys,
  extractAck,
  labelFor,
} from '../src/index.js';

function isa(isa13: string): string {
  const e = '*';
  return [
    'ISA', '00', ' '.repeat(10), '00', ' '.repeat(10), 'ZZ', 'SENDER'.padEnd(15),
    'ZZ', 'RECEIVER'.padEnd(15), '260101', '1200', 'U', '00401', isa13, '0', 'P',
  ].join(e) + e + ':' + '~';
}

const ORDER_850 =
  isa('000000850') + 'GS*PO*SENDER*RECEIVER*20260101*1200*1*X*004010~' +
  ['ST*850*0001', 'BEG*00*SA*PO-12345**20260115', 'REF*DP*001',
   'PO1*1*10*EA*25.00**VP*VENDPART1', 'PO1*2*5*CA*40.00**VP*VENDPART2',
   'CTT*2', 'SE*7*0001'].join('~') + '~GE*1*1~IEA*1*000000850~';

const INVOICE_810 =
  isa('000000810') + 'GS*IN*SENDER*RECEIVER*20260101*1200*1*X*004010~' +
  ['ST*810*0001', 'BIG*20260201*INV-9001*20260115*PO-12345',
   'IT1*1*10*EA*25.00**VP*VENDPART1', 'TDS*25000', 'CTT*1', 'SE*6*0001'].join('~') + '~GE*1*1~IEA*1*000000810~';

function firstTxn(raw: string) {
  return decomposeInterchange(raw).interchange.groups[0]!.transactions[0]!;
}

test('interprets an 850 header and line items', () => {
  const interp = interpretTransaction(firstTxn(ORDER_850));
  assert.equal(interp.type, '850');
  if (interp.type === '850') {
    assert.equal(interp.purpose, '00');
    assert.equal(interp.poNumber, 'PO-12345');
    assert.equal(interp.poDate, '20260115');
    assert.equal(interp.lineItems.length, 2);
    assert.deepEqual(interp.lineItems[0], {
      lineNumber: '1', quantity: '10', unitOfMeasure: 'EA', unitPrice: '25.00',
      productIdQualifier: 'VP', productId: 'VENDPART1',
    });
    assert.equal(interp.lineItems[1]!.productId, 'VENDPART2');
  }
});

test('interprets an 810 header, totals and line items', () => {
  const interp = interpretTransaction(firstTxn(INVOICE_810));
  assert.equal(interp.type, '810');
  if (interp.type === '810') {
    assert.equal(interp.invoiceNumber, 'INV-9001');
    assert.equal(interp.invoiceDate, '20260201');
    assert.equal(interp.poNumber, 'PO-12345');
    assert.equal(interp.totalAmount, '25000');
    assert.equal(interp.lineItems.length, 1);
    assert.equal(interp.lineItems[0]!.quantity, '10');
  }
});

test('extracts business keys for 850 and 810', () => {
  assert.deepEqual(extractBusinessKeys(firstTxn(ORDER_850)), {
    poNumber: 'PO-12345', invoiceNumber: null, shipmentId: null, purpose: '00',
  });
  assert.deepEqual(extractBusinessKeys(firstTxn(INVOICE_810)), {
    poNumber: 'PO-12345', invoiceNumber: 'INV-9001', shipmentId: null, purpose: null,
  });
});

test('labelFor resolves set-specific and common labels', () => {
  assert.equal(labelFor('850', 'BEG', 3), 'Purchase Order Number');
  assert.equal(labelFor('850', 'PO1', 2), 'Quantity Ordered');
  assert.equal(labelFor('810', 'BIG', 2), 'Invoice Number');
  assert.equal(labelFor('810', 'IT1', 4), 'Unit Price');
  assert.equal(labelFor('850', 'ST', 1), 'Transaction Set Identifier Code'); // common
  assert.equal(labelFor('850', 'BEG', 99), null);
  assert.equal(labelFor('997', 'AK1', 1), 'Functional Identifier Code'); // 997 now supported
});

test('unknown transaction set is interpreted as unknown', () => {
  const raw = isa('000000940') + 'GS*OW*S*R*20260101*1200*1*X*004010~ST*940*0001~W05*N*ORDER1~SE*3*0001~GE*1*1~IEA*1*000000940~';
  const interp = interpretTransaction(firstTxn(raw));
  assert.equal(interp.type, 'unknown');
  assert.deepEqual(extractBusinessKeys(firstTxn(raw)), { poNumber: null, invoiceNumber: null, shipmentId: null, purpose: null });
});

test('interprets an 850 with DTM delivery date as requestedDeliveryDate', () => {
  const raw = isa('000000851') + 'GS*PO*SENDER*RECEIVER*20260101*1200*1*X*004010~' +
    ['ST*850*0001', 'BEG*00*SA*PO-12345**20260115', 'DTM*002*20260408',
     'PO1*1*10*EA*25.00**VP*VENDPART1', 'SE*5*0001'].join('~') + '~GE*1*1~IEA*1*000000851~';
  const interp = interpretTransaction(firstTxn(raw));
  assert.equal(interp.type, '850');
  if (interp.type === '850') {
    assert.equal(interp.requestedDeliveryDate, '20260408');
  }
});

test('interprets an 810 with multiple REF*PO* segments', () => {
  const raw = isa('000000811') + 'GS*IN*SENDER*RECEIVER*20260101*1200*1*X*004010~' +
    ['ST*810*0001', 'BIG*20260201*INV-MULTI*20260115*PO-PRIMARY',
     'REF*PO*PO-SECOND', 'REF*PO*PO-THIRD', 'TDS*25000', 'SE*6*0001'].join('~') +
    '~GE*1*1~IEA*1*000000811~';
  const interp = interpretTransaction(firstTxn(raw));
  assert.equal(interp.type, '810');
  if (interp.type === '810') {
    assert.deepEqual(interp.poReferences.sort(), ['PO-PRIMARY', 'PO-SECOND', 'PO-THIRD']);
  }
});

test('interprets an 855 PO acknowledgment and its PO number', () => {
  const raw = isa('000000855') + 'GS*PR*SENDER*RECEIVER*20260101*1200*1*X*004010~' +
    ['ST*855*0001', 'BAK*00*AC*PO-12345*20260102', 'PO1*1*10*EA*25.00**VP*VENDPART1', 'SE*4*0001'].join('~') + '~GE*1*1~IEA*1*000000855~';
  const interp = interpretTransaction(firstTxn(raw));
  assert.equal(interp.type, '855');
  if (interp.type === '855') {
    assert.equal(interp.poNumber, 'PO-12345');
    assert.equal(interp.ackType, 'AC');
  }
  assert.equal(extractBusinessKeys(firstTxn(raw)).poNumber, 'PO-12345');
});

test('interprets an 856 ASN with shipment id and PO reference', () => {
  const raw = isa('000000856') + 'GS*SH*SENDER*RECEIVER*20260101*1200*1*X*004010~' +
    ['ST*856*0001', 'BSN*00*SHIP-555*20260103*1200', 'HL*1**S', 'PRF*PO-12345', 'SE*5*0001'].join('~') + '~GE*1*1~IEA*1*000000856~';
  const interp = interpretTransaction(firstTxn(raw));
  assert.equal(interp.type, '856');
  if (interp.type === '856') {
    assert.equal(interp.shipmentId, 'SHIP-555');
    assert.equal(interp.poNumber, 'PO-12345');
  }
  const keys = extractBusinessKeys(firstTxn(raw));
  assert.equal(keys.shipmentId, 'SHIP-555');
  assert.equal(keys.poNumber, 'PO-12345');
});

test('extractAck reads which transactions a 997 acknowledges (incl. a reject)', () => {
  const raw = isa('000000970') + 'GS*FA*RECEIVER*SENDER*20260101*1200*1*X*004010~' +
    ['ST*997*0001', 'AK1*PO*100', 'AK2*850*0001', 'AK5*A', 'AK2*850*0002', 'AK5*R', 'AK9*E*2*2*1', 'SE*8*0001'].join('~') + '~GE*1*1~IEA*1*000000970~';
  const ack = extractAck(firstTxn(raw));
  assert.ok(ack);
  assert.equal(ack.functionalIdCode, 'PO');
  assert.equal(ack.groupControl, '100');
  assert.equal(ack.groupStatus, 'E');
  assert.equal(ack.transactions.length, 2);
  // Phase 5: deepEqual against the basic fields; the new statusMessage +
  // errors[] fields are asserted in dedicated tests below.
  assert.equal(ack.transactions[0]!.setId, '850');
  assert.equal(ack.transactions[0]!.control, '0001');
  assert.equal(ack.transactions[0]!.status, 'A');
  assert.equal(ack.transactions[1]!.setId, '850');
  assert.equal(ack.transactions[1]!.control, '0002');
  assert.equal(ack.transactions[1]!.status, 'R');
  // Phase 5 enrichments — clean transactions get null error trees.
  assert.equal(ack.transactions[0]!.errors.length, 0);
  assert.equal(ack.transactions[1]!.errors.length, 0);
  assert.equal(ack.transactions[0]!.statusMessage, 'Accepted');
  assert.equal(ack.transactions[1]!.statusMessage, 'Rejected');
  assert.equal(ack.groupStatusMessage, 'Accepted but errors were noted');
});

test('extractAck returns null for non-ack sets', () => {
  const raw = isa('000000851') + 'GS*PO*S*R*20260101*1200*1*X*004010~ST*850*0001~BEG*00*SA*PO-1**20260101~SE*3*0001~GE*1*1~IEA*1*000000851~';
  assert.equal(extractAck(firstTxn(raw)), null);
});

test('interprets an 860 PO Change and exposes original + revised PO numbers', () => {
  const raw = isa('000000860') + 'GS*PC*SENDER*RECEIVER*20260101*1200*1*X*004010~' +
    ['ST*860*0001', 'BCH*04*SA*PO-12345**20260120**PO-12345*1',
     'PO1*1*15*EA*25.00**VP*VENDPART1', 'SE*4*0001'].join('~') + '~GE*1*1~IEA*1*000000860~';
  const interp = interpretTransaction(firstTxn(raw));
  assert.equal(interp.type, '860');
  if (interp.type === '860') {
    assert.equal(interp.poNumber, 'PO-12345');
    assert.equal(interp.originalPoNumber, 'PO-12345');
    assert.equal(interp.purpose, '04');
    assert.equal(interp.lineItems.length, 1);
    assert.equal(interp.lineItems[0]!.quantity, '15');
  }
  assert.equal(extractBusinessKeys(firstTxn(raw)).poNumber, 'PO-12345');
});

test('interprets an 875 Grocery PO via BPO and surfaces the PO number', () => {
  const raw = isa('000000875') + 'GS*SG*SENDER*RECEIVER*20260101*1200*1*X*004010~' +
    ['ST*875*0001', 'BPO*00*PO-99001*20260105', 'SE*3*0001'].join('~') + '~GE*1*1~IEA*1*000000875~';
  const interp = interpretTransaction(firstTxn(raw));
  assert.equal(interp.type, '875');
  if (interp.type === '875') {
    assert.equal(interp.poNumber, 'PO-99001');
    assert.equal(interp.purpose, '00');
    assert.equal(interp.poDate, '20260105');
  }
  assert.equal(extractBusinessKeys(firstTxn(raw)).poNumber, 'PO-99001');
});

test('interprets an 880 Grocery Invoice via BIG with invoice + PO', () => {
  const raw = isa('000000880') + 'GS*GP*SENDER*RECEIVER*20260101*1200*1*X*004010~' +
    ['ST*880*0001', 'BIG*20260210*INV-77*20260105*PO-99001', 'TDS*123450', 'SE*4*0001'].join('~') +
    '~GE*1*1~IEA*1*000000880~';
  const interp = interpretTransaction(firstTxn(raw));
  assert.equal(interp.type, '880');
  if (interp.type === '880') {
    assert.equal(interp.invoiceNumber, 'INV-77');
    assert.equal(interp.poNumber, 'PO-99001');
    assert.equal(interp.totalAmount, '123450');
  }
  const keys = extractBusinessKeys(firstTxn(raw));
  assert.equal(keys.poNumber, 'PO-99001');
  assert.equal(keys.invoiceNumber, 'INV-77');
});

test('labelFor resolves 860/875/880 segments', () => {
  assert.equal(labelFor('860', 'BCH', 3), 'Purchase Order Number');
  assert.equal(labelFor('860', 'BCH', 7), 'Original Purchase Order Number');
  assert.equal(labelFor('875', 'BPO', 2), 'Purchase Order Number');
  assert.equal(labelFor('880', 'BIG', 2), 'Invoice Number');
  assert.equal(labelFor('880', 'BIG', 4), 'Purchase Order Number');
});

// ─────────────────────────────────────────────────────────────
// Phase 5 — AK3 (segment errors) + AK4 (element errors) parsing
// ─────────────────────────────────────────────────────────────

test('extractAck collects an AK3+AK4 tree for a rejected transaction', () => {
  // 850 control 0001 was rejected because BEG segment had element errors,
  // specifically BEG03 (PO number) was mandatory and missing.
  const raw = isa('000000980') + 'GS*FA*RECEIVER*SENDER*20260101*1200*1*X*004010~' +
    [
      'ST*997*0001',
      'AK1*PO*100',
      'AK2*850*0001',
      'AK3*BEG*2**8',       // BEG @ position 2 has data element errors
      'AK4*3*353*1*',       // element 3 (data elt ref 353) missing, no bad-value
      'AK5*R',
      'AK9*R*1*1*0',
      'SE*8*0001',
    ].join('~') + '~GE*1*1~IEA*1*000000980~';
  const ack = extractAck(firstTxn(raw));
  assert.ok(ack);
  assert.equal(ack.groupStatus, 'R');
  assert.equal(ack.groupStatusMessage, 'Rejected');
  assert.equal(ack.transactions.length, 1);
  const t = ack.transactions[0]!;
  assert.equal(t.status, 'R');
  assert.equal(t.statusMessage, 'Rejected');
  assert.equal(t.errors.length, 1);
  const segErr = t.errors[0]!;
  assert.equal(segErr.segmentTag, 'BEG');
  assert.equal(segErr.segmentPosition, '2');
  assert.equal(segErr.syntaxErrorCode, '8');
  assert.equal(segErr.syntaxErrorMessage, 'Segment Has Data Element Errors');
  assert.equal(segErr.elementErrors.length, 1);
  const elErr = segErr.elementErrors[0]!;
  assert.equal(elErr.elementPosition, '3');
  assert.equal(elErr.dataElementReference, '353');
  assert.equal(elErr.syntaxErrorCode, '1');
  assert.equal(elErr.syntaxErrorMessage, 'Mandatory data element missing');
  assert.equal(elErr.badValue, '');
});

test('extractAck handles multi-error: two AK3 blocks under one AK2, then a clean AK2', () => {
  const raw = isa('000000981') + 'GS*FA*RECEIVER*SENDER*20260101*1200*1*X*004010~' +
    [
      'ST*997*0001',
      'AK1*PO*101',
      // First acked transaction with two distinct segment errors.
      'AK2*850*0001',
      'AK3*BEG*2**8',
      'AK4*3*353*1',
      'AK3*PO1*4**7',       // PO1 not in proper sequence
      'AK5*R',
      // Second acked transaction — clean accept.
      'AK2*850*0002',
      'AK5*A',
      'AK9*P*2*2*1',
      'SE*10*0001',
    ].join('~') + '~GE*1*1~IEA*1*000000981~';
  const ack = extractAck(firstTxn(raw));
  assert.ok(ack);
  assert.equal(ack.transactions.length, 2);
  const t1 = ack.transactions[0]!;
  assert.equal(t1.errors.length, 2);
  assert.equal(t1.errors[0]!.segmentTag, 'BEG');
  assert.equal(t1.errors[0]!.elementErrors.length, 1);
  assert.equal(t1.errors[1]!.segmentTag, 'PO1');
  assert.equal(t1.errors[1]!.syntaxErrorMessage, 'Segment Not in Proper Sequence');
  assert.equal(t1.errors[1]!.elementErrors.length, 0);
  const t2 = ack.transactions[1]!;
  assert.equal(t2.status, 'A');
  assert.equal(t2.errors.length, 0);
  // Group AK9.01 = "P" → partial acceptance.
  assert.equal(ack.groupStatus, 'P');
  assert.equal(
    ack.groupStatusMessage,
    'Partially accepted, at least one transaction set was rejected',
  );
});

test('extractAck falls back gracefully on an unknown syntax code', () => {
  const raw = isa('000000982') + 'GS*FA*RECEIVER*SENDER*20260101*1200*1*X*004010~' +
    [
      'ST*997*0001',
      'AK1*PO*102',
      'AK2*850*0001',
      'AK3*BEG*2**99',      // 99 isn't a defined AK304 code
      'AK4*3*353*88',       // 88 isn't a defined AK403 code
      'AK5*R',
      'AK9*R*1*1*0',
      'SE*8*0001',
    ].join('~') + '~GE*1*1~IEA*1*000000982~';
  const ack = extractAck(firstTxn(raw));
  assert.ok(ack);
  const segErr = ack.transactions[0]!.errors[0]!;
  assert.equal(segErr.syntaxErrorCode, '99');
  assert.equal(segErr.syntaxErrorMessage, null); // unknown → null, not crash
  const elErr = segErr.elementErrors[0]!;
  assert.equal(elErr.syntaxErrorCode, '88');
  assert.equal(elErr.syntaxErrorMessage, null);
});

test('extractAck preserves the bad value when AK404 is populated', () => {
  const raw = isa('000000983') + 'GS*FA*RECEIVER*SENDER*20260101*1200*1*X*004010~' +
    [
      'ST*997*0001',
      'AK1*PO*103',
      'AK2*850*0001',
      'AK3*BEG*2**8',
      'AK4*1*353*7*ZZZ',    // element 1, code 7 (invalid code value), bad value "ZZZ"
      'AK5*R',
      'AK9*R*1*1*0',
      'SE*8*0001',
    ].join('~') + '~GE*1*1~IEA*1*000000983~';
  const ack = extractAck(firstTxn(raw));
  assert.ok(ack);
  const elErr = ack.transactions[0]!.errors[0]!.elementErrors[0]!;
  assert.equal(elErr.badValue, 'ZZZ');
  assert.equal(elErr.syntaxErrorMessage, 'Invalid code value');
});
