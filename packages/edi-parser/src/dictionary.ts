/**
 * X12 997/999 acknowledgment code dictionary.
 *
 * Single source of truth for translating raw codes into the X12 spec's
 * published wording. The same constants are mirrored verbatim in
 * `data/ack-codes.json` for human audit and Phase 6 override-tooling, but the
 * runtime dictionary lives here so the library has zero file-I/O at startup
 * and bundles cleanly.
 *
 * Mapping reference (per X12 spec):
 *  - AK304 — Segment Syntax Error Code (codes 1–8)
 *  - AK403 — Data Element Syntax Error Code (codes 1–13; 11 is reserved/unused)
 *  - AK501 — Transaction Set Acknowledgment Code (A/E/M/P/R/W/X)
 *  - AK901 — Functional Group Acknowledge Code (same set as AK501)
 *
 * If a partner emits a code outside the standard set we never crash — the
 * decoders return null and the caller surfaces the raw code with a generic
 * fallback like "Unknown <field> code <N>".
 */

export const AK304_SEGMENT_SYNTAX: Readonly<Record<string, string>> = Object.freeze({
  '1': 'Unrecognized segment ID',
  '2': 'Unexpected segment',
  '3': 'Required Segment Missing',
  '4': 'Loop Occurs Over Maximum Times',
  '5': 'Segment Exceeds Maximum Use',
  '6': 'Segment Not in Defined Transaction Set',
  '7': 'Segment Not in Proper Sequence',
  '8': 'Segment Has Data Element Errors',
});

export const AK403_ELEMENT_SYNTAX: Readonly<Record<string, string>> = Object.freeze({
  '1': 'Mandatory data element missing',
  '2': 'Conditional required data element missing',
  '3': 'Too many data elements',
  '4': 'Data element too short',
  '5': 'Data element too long',
  '6': 'Invalid character in data element',
  '7': 'Invalid code value',
  '8': 'Invalid Date',
  '9': 'Invalid Time',
  '10': 'Exclusion Condition Violated',
  '12': 'Too many repetitions',
  '13': 'Too many components',
});

const ACK_CODES: Readonly<Record<string, string>> = Object.freeze({
  A: 'Accepted',
  E: 'Accepted but errors were noted',
  M: 'Rejected, message authentication code (MAC) failed',
  P: 'Partially accepted, at least one transaction set was rejected',
  R: 'Rejected',
  W: 'Rejected, assurance failed validity tests',
  X: 'Rejected, content after decryption could not be analyzed',
});

export const AK501_TRANSACTION_ACK = ACK_CODES;
export const AK901_GROUP_ACK = ACK_CODES;

/** Decode a segment-syntax error code (AK304). Returns null on unknown. */
export function decodeSegmentSyntaxError(code: string): string | null {
  return AK304_SEGMENT_SYNTAX[code] ?? null;
}

/** Decode an element-syntax error code (AK403). Returns null on unknown. */
export function decodeElementSyntaxError(code: string): string | null {
  return AK403_ELEMENT_SYNTAX[code] ?? null;
}

/** Decode a transaction acknowledgment code (AK501). Returns null on unknown. */
export function decodeTransactionAckCode(code: string): string | null {
  return AK501_TRANSACTION_ACK[code] ?? null;
}

/** Decode a group acknowledgment code (AK901). Returns null on unknown. */
export function decodeGroupAckCode(code: string): string | null {
  return AK901_GROUP_ACK[code] ?? null;
}

/** A small helper that wraps an unknown code with a generic fallback so the
 *  UI always has something to display. */
export function describeOrUnknown(field: string, code: string, lookup: (c: string) => string | null): string {
  const m = lookup(code);
  if (m) return m;
  if (code === '') return `${field}: (no code)`;
  return `${field}: unknown code "${code}"`;
}
