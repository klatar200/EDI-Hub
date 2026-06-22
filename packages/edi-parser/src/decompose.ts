/**
 * Full X12 decomposition: a raw transmission -> the ISA -> GS -> ST/SE ->
 * segment -> element tree, for ANY transaction set. Set-specific semantics
 * (850/810 typed fields, semantic labels) are layered on in the next sprint.
 *
 * Structural problems that make the envelope unreadable throw EdiParseError.
 * Control-count mismatches (SE/GE/IEA counts, ST/SE control-number disagreement)
 * are collected as non-fatal `warnings` — real-world senders get these wrong and
 * we still want the data.
 */
import { detectDelimiters, EdiParseError, type Delimiters } from './core.js';

export interface DecomposedElement {
  /** 1-based position within the segment (element 1 = e.g. ISA01). */
  index: number;
  value: string;
}

export interface DecomposedSegment {
  tag: string;
  /** 0-based ordinal of this segment within its transaction. */
  position: number;
  elements: DecomposedElement[];
}

export interface DecomposedTransaction {
  /** ST01 — e.g. "850", "810". */
  transactionSetId: string;
  /** ST02 — transaction control number. */
  controlNumber: string;
  /** SE01 — declared segment count (incl. ST and SE), if present. */
  declaredSegmentCount: number | null;
  /** Actual segments counted (incl. ST and SE). */
  segmentCount: number;
  segments: DecomposedSegment[];
}

export interface DecomposedGroup {
  /** GS01 — functional identifier code (e.g. "PO", "IN"). */
  functionalIdCode: string;
  /** GS06 — group control number. */
  controlNumber: string;
  /** GS08 — version (e.g. "004010"). */
  version: string;
  /** GE01 — declared transaction count, if present. */
  declaredTransactionCount: number | null;
  transactions: DecomposedTransaction[];
}

export interface DecomposedInterchange {
  /** ISA13. */
  isaControlNumber: string;
  /** ISA06 (trimmed). */
  senderId: string;
  /** ISA08 (trimmed). */
  receiverId: string;
  /** ISA12 — interchange control version (e.g. "00401"). */
  version: string;
  /** IEA01 — declared group count, if present. */
  declaredGroupCount: number | null;
  delimiters: Delimiters;
  groups: DecomposedGroup[];
}

export interface DecomposeResult {
  interchange: DecomposedInterchange;
  /** Non-fatal control-count / consistency issues. */
  warnings: string[];
}

/** A raw, untyped segment: its tag and the element strings that follow it. */
export interface RawSegment {
  tag: string;
  elements: string[];
}

/**
 * Split a transmission into raw segments using the ISA-detected delimiters.
 * Empty segments (e.g. trailing whitespace after the last terminator) are
 * dropped. Does not interpret the hierarchy — see {@link decomposeInterchange}.
 */
export function tokenize(rawContent: string): { delimiters: Delimiters; segments: RawSegment[] } {
  const { delimiters, isaStart } = detectDelimiters(rawContent);
  const body = rawContent.slice(isaStart);
  const segments = body
    .split(delimiters.segment)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const parts = s.split(delimiters.element);
      return { tag: parts[0]!, elements: parts.slice(1) };
    });
  return { delimiters, segments };
}

function el(seg: RawSegment, oneBasedIndex: number): string {
  return (seg.elements[oneBasedIndex - 1] ?? '').trim();
}

function toDecomposedSegment(seg: RawSegment, position: number): DecomposedSegment {
  return {
    tag: seg.tag,
    position,
    elements: seg.elements.map((value, i) => ({ index: i + 1, value })),
  };
}

function parseCount(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Decompose a raw X12 transmission into the full envelope hierarchy.
 * Handles batched interchanges (multiple GS groups, multiple ST transactions).
 */
export function decomposeInterchange(rawContent: string): DecomposeResult {
  const { delimiters, segments } = tokenize(rawContent);
  const warnings: string[] = [];

  const isa = segments[0];
  if (!isa || isa.tag !== 'ISA') {
    throw new EdiParseError('Transmission does not begin with an ISA segment.', 'MALFORMED');
  }

  const isaControlNumber = el(isa, 13);
  if (isaControlNumber === '') {
    throw new EdiParseError('ISA13 (interchange control number) is empty.', 'MALFORMED');
  }

  const interchange: DecomposedInterchange = {
    isaControlNumber,
    senderId: el(isa, 6),
    receiverId: el(isa, 8),
    version: el(isa, 12),
    declaredGroupCount: null,
    delimiters,
    groups: [],
  };

  let currentGroup: DecomposedGroup | null = null;
  let currentTxn: DecomposedTransaction | null = null;
  // Track SE control numbers to compare against ST.
  const seControlByTxn = new WeakMap<DecomposedTransaction, string>();

  for (const seg of segments) {
    switch (seg.tag) {
      case 'ISA':
        break; // already captured
      case 'GS':
        currentGroup = {
          functionalIdCode: el(seg, 1),
          controlNumber: el(seg, 6),
          version: el(seg, 8),
          declaredTransactionCount: null,
          transactions: [],
        };
        interchange.groups.push(currentGroup);
        break;
      case 'GE':
        if (currentGroup) {
          currentGroup.declaredTransactionCount = parseCount(el(seg, 1));
          if (
            currentGroup.declaredTransactionCount !== null &&
            currentGroup.declaredTransactionCount !== currentGroup.transactions.length
          ) {
            warnings.push(
              `GE01 transaction count ${currentGroup.declaredTransactionCount} != ${currentGroup.transactions.length} actual (group ${currentGroup.controlNumber}).`,
            );
          }
          currentGroup = null;
        } else {
          warnings.push('GE encountered without a matching GS.');
        }
        break;
      case 'ST': {
        const txn: DecomposedTransaction = {
          transactionSetId: el(seg, 1),
          controlNumber: el(seg, 2),
          declaredSegmentCount: null,
          segmentCount: 0,
          segments: [toDecomposedSegment(seg, 0)],
        };
        currentTxn = txn;
        if (currentGroup) currentGroup.transactions.push(txn);
        else warnings.push(`ST (${txn.transactionSetId}) encountered outside any GS group.`);
        break;
      }
      case 'SE':
        if (currentTxn) {
          currentTxn.segments.push(toDecomposedSegment(seg, currentTxn.segments.length));
          currentTxn.declaredSegmentCount = parseCount(el(seg, 1));
          currentTxn.segmentCount = currentTxn.segments.length;
          if (
            currentTxn.declaredSegmentCount !== null &&
            currentTxn.declaredSegmentCount !== currentTxn.segmentCount
          ) {
            warnings.push(
              `SE01 segment count ${currentTxn.declaredSegmentCount} != ${currentTxn.segmentCount} actual (transaction ${currentTxn.controlNumber}).`,
            );
          }
          seControlByTxn.set(currentTxn, el(seg, 2));
          if (el(seg, 2) !== currentTxn.controlNumber) {
            warnings.push(
              `SE02 control number ${el(seg, 2)} != ST02 ${currentTxn.controlNumber}.`,
            );
          }
          currentTxn = null;
        } else {
          warnings.push('SE encountered without a matching ST.');
        }
        break;
      case 'IEA':
        interchange.declaredGroupCount = parseCount(el(seg, 1));
        if (
          interchange.declaredGroupCount !== null &&
          interchange.declaredGroupCount !== interchange.groups.length
        ) {
          warnings.push(
            `IEA01 group count ${interchange.declaredGroupCount} != ${interchange.groups.length} actual.`,
          );
        }
        break;
      default:
        if (currentTxn) {
          currentTxn.segments.push(toDecomposedSegment(seg, currentTxn.segments.length));
          currentTxn.segmentCount = currentTxn.segments.length;
        } else {
          warnings.push(`Segment ${seg.tag} found outside any transaction; ignored.`);
        }
    }
  }

  if (currentTxn) warnings.push(`Transaction ${currentTxn.controlNumber} was not closed by an SE.`);
  if (currentGroup) warnings.push(`Group ${currentGroup.controlNumber} was not closed by a GE.`);

  return { interchange, warnings };
}
