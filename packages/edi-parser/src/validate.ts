/**
 * Per-transaction semantic validation for the supported sets.
 *
 * A transaction can be perfectly valid X12 at the envelope level yet be
 * semantically broken (e.g. an 850 with no PO number). We never throw on these
 * — the generic tree is always persisted — but we surface them as severity-
 * tagged issues so the caller can flag the file PARSE_ERROR with a useful
 * message while sibling transactions in the same file still parse.
 */
import type { DecomposedTransaction, DecomposedSegment } from './decompose.js';

export interface TransactionIssue {
  severity: 'error' | 'warning';
  transactionSetId: string;
  controlNumber: string;
  /** Human-useful description, naming the segment/element where possible. */
  message: string;
}

function firstSegment(txn: DecomposedTransaction, tag: string): DecomposedSegment | undefined {
  return txn.segments.find((s) => s.tag === tag);
}

function ev(seg: DecomposedSegment | undefined, index: number): string {
  return seg?.elements.find((e) => e.index === index)?.value ?? '';
}

/**
 * Validate a decomposed transaction's required header fields for its set.
 * Returns [] for sets we don't interpret (they're stored generically).
 */
export function validateTransaction(txn: DecomposedTransaction): TransactionIssue[] {
  const issues: TransactionIssue[] = [];
  const at = { transactionSetId: txn.transactionSetId, controlNumber: txn.controlNumber };

  if (txn.transactionSetId === '850') {
    const beg = firstSegment(txn, 'BEG');
    if (!beg) {
      issues.push({ ...at, severity: 'error', message: '850 is missing its BEG (purchase order header) segment.' });
    } else if (ev(beg, 3) === '') {
      issues.push({ ...at, severity: 'error', message: '850 is missing the Purchase Order Number (BEG03).' });
    }
    if (!firstSegment(txn, 'PO1')) {
      issues.push({ ...at, severity: 'warning', message: '850 has no line items (no PO1 segment).' });
    }
  } else if (txn.transactionSetId === '810') {
    const big = firstSegment(txn, 'BIG');
    if (!big) {
      issues.push({ ...at, severity: 'error', message: '810 is missing its BIG (invoice header) segment.' });
    } else if (ev(big, 2) === '') {
      issues.push({ ...at, severity: 'error', message: '810 is missing the Invoice Number (BIG02).' });
    }
    if (!firstSegment(txn, 'IT1')) {
      issues.push({ ...at, severity: 'warning', message: '810 has no line items (no IT1 segment).' });
    }
  } else if (txn.transactionSetId === '855') {
    const bak = firstSegment(txn, 'BAK');
    if (!bak) {
      issues.push({ ...at, severity: 'error', message: '855 is missing its BAK (PO acknowledgment header) segment.' });
    } else if (ev(bak, 3) === '') {
      issues.push({ ...at, severity: 'error', message: '855 is missing the Purchase Order Number (BAK03).' });
    }
  } else if (txn.transactionSetId === '856') {
    if (!firstSegment(txn, 'BSN')) {
      issues.push({ ...at, severity: 'error', message: '856 is missing its BSN (shipment header) segment.' });
    }
    if (!firstSegment(txn, 'PRF')) {
      issues.push({ ...at, severity: 'warning', message: '856 has no PRF (purchase order reference); cannot link to a PO.' });
    }
  } else if (txn.transactionSetId === '860') {
    const bch = firstSegment(txn, 'BCH');
    if (!bch) {
      issues.push({ ...at, severity: 'error', message: '860 is missing its BCH (purchase order change header) segment.' });
    } else if (ev(bch, 3) === '') {
      issues.push({ ...at, severity: 'error', message: '860 is missing the Purchase Order Number (BCH03).' });
    }
  } else if (txn.transactionSetId === '875') {
    const bpo = firstSegment(txn, 'BPO');
    if (!bpo) {
      issues.push({ ...at, severity: 'error', message: '875 is missing its BPO (grocery PO header) segment.' });
    } else if (ev(bpo, 2) === '') {
      issues.push({ ...at, severity: 'error', message: '875 is missing the Purchase Order Number (BPO02).' });
    }
  } else if (txn.transactionSetId === '880') {
    const big = firstSegment(txn, 'BIG');
    if (!big) {
      issues.push({ ...at, severity: 'error', message: '880 is missing its BIG (grocery invoice header) segment.' });
    } else if (ev(big, 2) === '') {
      issues.push({ ...at, severity: 'error', message: '880 is missing the Invoice Number (BIG02).' });
    }
  } else if (txn.transactionSetId === '997' || txn.transactionSetId === '999') {
    if (!firstSegment(txn, 'AK1')) {
      issues.push({ ...at, severity: 'error', message: 'Functional acknowledgment is missing its AK1 (group response) segment.' });
    }
  }

  return issues;
}
