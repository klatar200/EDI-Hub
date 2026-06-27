/**
 * Transaction-set semantics for the order-to-invoice loop:
 *   850 Purchase Order, 855 PO Acknowledgment, 856 Ship Notice (ASN),
 *   810 Invoice, and 997/999 Functional Acknowledgment.
 *
 * Phase 4 Sprint 1 adds the grocery-flavored sets the pilot actually
 * exchanges: 860 (PO Change), 875 (Grocery PO), 880 (Grocery Invoice).
 *
 * Phase 5 Sprint 1 extends 997 parsing from "did this pass or fail" to
 * structured AK3 (segment-level) and AK4 (element-level) error detail,
 * decoded against the X12 dictionary so the UI can render plain English.
 *
 *   - `labelFor` — hand-authored data dictionary (an element knows it is a "PO
 *     Number", not just "BEG03").
 *   - `interpretTransaction` — typed header + line items per set.
 *   - `extractBusinessKeys` — the keys the lifecycle stitches on (PO / invoice /
 *     shipment).
 *   - `extractAck` — for 997/999, the control numbers it acknowledges + status,
 *     plus the structured AK3/AK4 error tree per acked transaction.
 *
 * Operates on the generic `DecomposedTransaction` tree, so it stays pure.
 */
import type { DecomposedTransaction, DecomposedSegment } from './decompose.js';
import {
  decodeElementSyntaxError,
  decodeGroupAckCode,
  decodeSegmentSyntaxError,
  decodeTransactionAckCode,
} from './dictionary.js';

type LabelTable = Record<string, readonly (string | null)[]>;

const COMMON_LABELS: LabelTable = {
  ST: ['Transaction Set Identifier Code', 'Transaction Set Control Number'],
  SE: ['Number of Included Segments', 'Transaction Set Control Number'],
  CTT: ['Number of Line Items', 'Hash Total'],
  REF: ['Reference Identification Qualifier', 'Reference Identification'],
  DTM: ['Date/Time Qualifier', 'Date'],
  N1: ['Entity Identifier Code', 'Name', 'Identification Code Qualifier', 'Identification Code'],
};

const LABELS_850: LabelTable = {
  BEG: ['Transaction Set Purpose Code', 'Purchase Order Type Code', 'Purchase Order Number', 'Release Number', 'Purchase Order Date'],
  PO1: ['Assigned Identification', 'Quantity Ordered', 'Unit or Basis for Measurement', 'Unit Price', 'Basis of Unit Price Code', 'Product/Service ID Qualifier', 'Product/Service ID'],
};
const LABELS_855: LabelTable = {
  BAK: ['Transaction Set Purpose Code', 'Acknowledgment Type', 'Purchase Order Number', 'Release Number', 'Purchase Order Date'],
  PO1: LABELS_850.PO1!,
};
const LABELS_856: LabelTable = {
  BSN: ['Transaction Set Purpose Code', 'Shipment Identification', 'Date', 'Time', 'Hierarchical Structure Code'],
  PRF: ['Purchase Order Number', 'Release Number', 'Change Order Sequence Number', 'Purchase Order Date'],
};
const LABELS_810: LabelTable = {
  BIG: ['Invoice Date', 'Invoice Number', 'Purchase Order Date', 'Purchase Order Number'],
  IT1: ['Assigned Identification', 'Quantity Invoiced', 'Unit or Basis for Measurement', 'Unit Price', 'Basis of Unit Price Code', 'Product/Service ID Qualifier', 'Product/Service ID'],
  TDS: ['Total Invoice Amount'],
};
const LABELS_860: LabelTable = {
  BCH: [
    'Transaction Set Purpose Code',
    'Purchase Order Type Code',
    'Purchase Order Number',
    'Release Number',
    'Purchase Order Date',
    'Contract Number',
    'Original Purchase Order Number',
    'Change Order Sequence Number',
  ],
  PO1: LABELS_850.PO1!,
};
const LABELS_875: LabelTable = {
  BPO: ['Transaction Set Purpose Code', 'Purchase Order Number', 'Purchase Order Date'],
};
const LABELS_880: LabelTable = {
  BIG: LABELS_810.BIG!,
  IT1: LABELS_810.IT1!,
  TDS: LABELS_810.TDS!,
};
const LABELS_997: LabelTable = {
  AK1: ['Functional Identifier Code', 'Group Control Number'],
  AK2: ['Transaction Set Identifier Code', 'Transaction Set Control Number'],
  AK3: ['Segment ID Code', 'Segment Position in Transaction Set', 'Loop Identifier Code', 'Segment Syntax Error Code'],
  AK4: ['Position in Segment', 'Data Element Reference Number', 'Data Element Syntax Error Code', 'Copy of Bad Data Element'],
  AK5: ['Transaction Set Acknowledgment Code'],
  IK5: ['Transaction Set Acknowledgment Code'],
  AK9: ['Functional Group Acknowledge Code', 'Number of Transaction Sets Included', 'Number of Received Transaction Sets', 'Number of Accepted Transaction Sets'],
};

const SET_LABELS: Record<string, LabelTable> = {
  '850': LABELS_850, '855': LABELS_855, '856': LABELS_856, '810': LABELS_810,
  '860': LABELS_860, '875': LABELS_875, '880': LABELS_880,
  '997': LABELS_997, '999': LABELS_997,
};

export const SUPPORTED_SETS = ['850', '855', '856', '810', '860', '875', '880', '997', '999'] as const;

export function labelFor(transactionSetId: string, segmentTag: string, elementIndex: number): string | null {
  const fromSet = SET_LABELS[transactionSetId]?.[segmentTag]?.[elementIndex - 1];
  if (fromSet != null) return fromSet;
  return COMMON_LABELS[segmentTag]?.[elementIndex - 1] ?? null;
}

// --- Typed interpretation ---

export interface LineItem {
  lineNumber: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  productIdQualifier: string;
  productId: string;
}

export interface Interpreted850 { type: '850'; purpose: string; poNumber: string; poDate: string; lineItems: LineItem[] }
export interface Interpreted855 { type: '855'; purpose: string; ackType: string; poNumber: string; lineItems: LineItem[]; totalQty: string }
export interface Interpreted856 { type: '856'; shipmentId: string; poNumber: string; shipDate: string; carrierRef: string; totalQty: string }
export interface Interpreted810 { type: '810'; invoiceNumber: string; invoiceDate: string; poNumber: string; totalAmount: string; lineItems: LineItem[] }
export interface Interpreted860 { type: '860'; purpose: string; poNumber: string; originalPoNumber: string; poDate: string; lineItems: LineItem[] }
export interface Interpreted875 { type: '875'; purpose: string; poNumber: string; poDate: string }
export interface Interpreted880 { type: '880'; invoiceNumber: string; invoiceDate: string; poNumber: string; totalAmount: string }

/** Phase 5 — one element-level error from an AK4 segment under an AK3. */
export interface AckElementError {
  /** AK401 — element position within the offending segment (e.g. "3" for BEG03). */
  elementPosition: string;
  /** AK402 — X12 data-element reference number (e.g. "353"). Optional / often empty. */
  dataElementReference: string;
  /** AK403 — element-level syntax error code (e.g. "1" = mandatory missing). */
  syntaxErrorCode: string;
  /** Decoded message from the dictionary, or null if the code is unknown. */
  syntaxErrorMessage: string | null;
  /** AK404 — copy of the bad value, if the sender provided one. */
  badValue: string;
}

/** Phase 5 — one segment-level error from an AK3 segment under an AK2. */
export interface AckSegmentError {
  /** AK301 — the segment ID code that erred (e.g. "BEG"). */
  segmentTag: string;
  /** AK302 — its position in the transaction set. */
  segmentPosition: string;
  /** AK303 — loop identifier, if provided. */
  loopIdentifier: string;
  /** AK304 — segment-level syntax error code (e.g. "8" = has element errors). */
  syntaxErrorCode: string;
  /** Decoded message from the dictionary, or null if the code is unknown. */
  syntaxErrorMessage: string | null;
  /** Per-element errors found inside this segment. */
  elementErrors: AckElementError[];
}

export interface AckedTransaction {
  setId: string;
  control: string;
  status: string;
  /** Phase 5 — decoded AK501 status (X12 wording), or null on unknown. */
  statusMessage: string | null;
  /** Phase 5 — structured AK3/AK4 tree. Empty when the txn was accepted clean. */
  errors: AckSegmentError[];
}

export interface Interpreted997 {
  type: '997';
  ackedFunctionalIdCode: string;
  ackedGroupControl: string;
  groupStatus: string;
  /** Phase 5 — decoded AK901 status, or null on unknown. */
  groupStatusMessage: string | null;
  transactions: AckedTransaction[];
}

export interface InterpretedUnknown { type: 'unknown'; transactionSetId: string }
export type InterpretedTransaction =
  | Interpreted850 | Interpreted855 | Interpreted856 | Interpreted810
  | Interpreted860 | Interpreted875 | Interpreted880
  | Interpreted997 | InterpretedUnknown;

export interface BusinessKeys {
  poNumber: string | null;
  invoiceNumber: string | null;
  shipmentId: string | null;
  purpose: string | null;
}

export interface AckInfo {
  functionalIdCode: string;
  groupControl: string;
  groupStatus: string;
  groupStatusMessage: string | null;
  transactions: AckedTransaction[];
}

function firstSegment(txn: DecomposedTransaction, tag: string): DecomposedSegment | undefined {
  return txn.segments.find((s) => s.tag === tag);
}
function ev(seg: DecomposedSegment | undefined, index: number): string {
  return seg?.elements.find((e) => e.index === index)?.value ?? '';
}
function lineItemsFrom(txn: DecomposedTransaction, tag: string): LineItem[] {
  return txn.segments
    .filter((s) => s.tag === tag)
    .map((s) => ({
      lineNumber: ev(s, 1), quantity: ev(s, 2), unitOfMeasure: ev(s, 3), unitPrice: ev(s, 4),
      productIdQualifier: ev(s, 6), productId: ev(s, 7),
    }));
}

export function interpretTransaction(txn: DecomposedTransaction): InterpretedTransaction {
  switch (txn.transactionSetId) {
    case '850': {
      const beg = firstSegment(txn, 'BEG');
      return { type: '850', purpose: ev(beg, 1), poNumber: ev(beg, 3), poDate: ev(beg, 5), lineItems: lineItemsFrom(txn, 'PO1') };
    }
    case '855': {
      const bak = firstSegment(txn, 'BAK');
      const items = lineItemsFrom(txn, 'PO1');
      const totalQty = items.reduce((sum, li) => sum + (Number(li.quantity) || 0), 0);
      return {
        type: '855',
        purpose: ev(bak, 1),
        ackType: ev(bak, 2),
        poNumber: ev(bak, 3),
        lineItems: items,
        totalQty: totalQty > 0 ? String(totalQty) : '',
      };
    }
    case '856': {
      const bsn = firstSegment(txn, 'BSN');
      const items = lineItemsFrom(txn, 'SN1');
      const totalQty = items.reduce((sum, li) => sum + (Number(li.quantity) || 0), 0);
      const refSeg = txn.segments.find((s) => s.tag === 'REF' && ev(s, 1) === 'CN');
      const td5 = firstSegment(txn, 'TD5');
      return {
        type: '856',
        shipmentId: ev(bsn, 2),
        shipDate: ev(bsn, 3),
        poNumber: ev(firstSegment(txn, 'PRF'), 1),
        carrierRef: ev(refSeg, 2) || ev(td5, 3) || ev(td5, 2),
        totalQty: totalQty > 0 ? String(totalQty) : '',
      };
    }
    case '810': {
      const big = firstSegment(txn, 'BIG');
      return { type: '810', invoiceDate: ev(big, 1), invoiceNumber: ev(big, 2), poNumber: ev(big, 4), totalAmount: ev(firstSegment(txn, 'TDS'), 1), lineItems: lineItemsFrom(txn, 'IT1') };
    }
    case '860': {
      const bch = firstSegment(txn, 'BCH');
      return {
        type: '860',
        purpose: ev(bch, 1),
        poNumber: ev(bch, 3),
        originalPoNumber: ev(bch, 7),
        poDate: ev(bch, 5),
        lineItems: lineItemsFrom(txn, 'PO1'),
      };
    }
    case '875': {
      const bpo = firstSegment(txn, 'BPO');
      return { type: '875', purpose: ev(bpo, 1), poNumber: ev(bpo, 2), poDate: ev(bpo, 3) };
    }
    case '880': {
      const big = firstSegment(txn, 'BIG');
      return {
        type: '880',
        invoiceDate: ev(big, 1),
        invoiceNumber: ev(big, 2),
        poNumber: ev(big, 4),
        totalAmount: ev(firstSegment(txn, 'TDS'), 1),
      };
    }
    case '997':
    case '999': {
      const ack = readAck(txn);
      return {
        type: '997',
        ackedFunctionalIdCode: ack.functionalIdCode,
        ackedGroupControl: ack.groupControl,
        groupStatus: ack.groupStatus,
        groupStatusMessage: ack.groupStatusMessage,
        transactions: ack.transactions,
      };
    }
    default:
      return { type: 'unknown', transactionSetId: txn.transactionSetId };
  }
}

function readAck(txn: DecomposedTransaction): AckInfo {
  const ak1 = firstSegment(txn, 'AK1');
  const ak9 = firstSegment(txn, 'AK9');
  const transactions: AckedTransaction[] = [];
  let pending: AckedTransaction | null = null;
  let pendingError: AckSegmentError | null = null;

  function flushError(): void {
    if (pendingError && pending) {
      pending.errors.push(pendingError);
    }
    pendingError = null;
  }
  function flushTxn(): void {
    flushError();
    if (pending) {
      transactions.push(pending);
      pending = null;
    }
  }

  for (const seg of txn.segments) {
    if (seg.tag === 'AK2') {
      flushTxn();
      pending = {
        setId: ev(seg, 1),
        control: ev(seg, 2),
        status: '',
        statusMessage: null,
        errors: [],
      };
    } else if (seg.tag === 'AK3' && pending) {
      flushError();
      const code = ev(seg, 4);
      pendingError = {
        segmentTag: ev(seg, 1),
        segmentPosition: ev(seg, 2),
        loopIdentifier: ev(seg, 3),
        syntaxErrorCode: code,
        syntaxErrorMessage: decodeSegmentSyntaxError(code),
        elementErrors: [],
      };
    } else if (seg.tag === 'AK4' && pendingError) {
      const code = ev(seg, 3);
      pendingError.elementErrors.push({
        elementPosition: ev(seg, 1),
        dataElementReference: ev(seg, 2),
        syntaxErrorCode: code,
        syntaxErrorMessage: decodeElementSyntaxError(code),
        badValue: ev(seg, 4),
      });
    } else if ((seg.tag === 'AK5' || seg.tag === 'IK5') && pending) {
      flushError();
      pending.status = ev(seg, 1);
      pending.statusMessage = decodeTransactionAckCode(pending.status);
    }
  }
  flushTxn();

  const groupStatus = ev(ak9, 1);
  return {
    functionalIdCode: ev(ak1, 1),
    groupControl: ev(ak1, 2),
    groupStatus,
    groupStatusMessage: decodeGroupAckCode(groupStatus),
    transactions,
  };
}

/** For 997/999 only: the controls it acknowledges + status. Null otherwise. */
export function extractAck(txn: DecomposedTransaction): AckInfo | null {
  if (txn.transactionSetId !== '997' && txn.transactionSetId !== '999') return null;
  return readAck(txn);
}

/** Extract the persisted business keys the lifecycle stitches on. */
export function extractBusinessKeys(txn: DecomposedTransaction): BusinessKeys {
  const interp = interpretTransaction(txn);
  switch (interp.type) {
    case '850':
      return { poNumber: interp.poNumber || null, invoiceNumber: null, shipmentId: null, purpose: interp.purpose || null };
    case '855':
      return { poNumber: interp.poNumber || null, invoiceNumber: null, shipmentId: null, purpose: interp.purpose || null };
    case '856':
      return { poNumber: interp.poNumber || null, invoiceNumber: null, shipmentId: interp.shipmentId || null, purpose: null };
    case '810':
      return { poNumber: interp.poNumber || null, invoiceNumber: interp.invoiceNumber || null, shipmentId: null, purpose: null };
    case '860':
      return { poNumber: interp.poNumber || null, invoiceNumber: null, shipmentId: null, purpose: interp.purpose || null };
    case '875':
      return { poNumber: interp.poNumber || null, invoiceNumber: null, shipmentId: null, purpose: interp.purpose || null };
    case '880':
      return { poNumber: interp.poNumber || null, invoiceNumber: interp.invoiceNumber || null, shipmentId: null, purpose: null };
    default:
      return { poNumber: null, invoiceNumber: null, shipmentId: null, purpose: null };
  }
}
