/**
 * @edi/edi-parser — X12 parsing library (pure TS, no framework deps).
 *
 *  - `extractEnvelopeIds` — minimal ISA/GS read for dedup + partner identity.
 *  - `decomposeInterchange` / `tokenize` — full ISA->GS->ST/SE->segment->element
 *    decomposition (Phase 2). Set-specific semantics (850/810) arrive next sprint.
 *
 * Kept intentionally dependency-free so it can be unit-tested in isolation —
 * critical given how much real-world EDI deviates from spec.
 */
import { detectDelimiters, EdiParseError, type Delimiters } from './core.js';

export const EDI_PARSER_VERSION = '0.2.0';

export * from './core.js';
export * from './decompose.js';
export * from './sets.js';
export * from './validate.js';
export * from './dictionary.js';

/** The handful of envelope identifiers needed for dedup + partner lookup. */
export interface EnvelopeIds {
  /** ISA13 — interchange control number. The dedup key. */
  isaControlNumber: string;
  /** GS06 — functional group control number (empty string if no GS found). */
  gsControlNumber: string;
  /** ISA06 — interchange sender ID (trimmed). */
  senderId: string;
  /** ISA08 — interchange receiver ID (trimmed). */
  receiverId: string;
  delimiters: Delimiters;
}

const SEGMENT_TERM_OFFSET = 105;

/**
 * Read the interchange/group identifiers from a raw X12 transmission.
 *
 * Detects delimiters from the ISA segment's fixed offsets (per the X12 spec),
 * so non-standard delimiter choices all work without hardcoding. Throws
 * {@link EdiParseError} (with a `kind`) on anything that isn't a parseable ISA
 * envelope — callers store the raw file and flag it rather than crashing.
 */
export function extractEnvelopeIds(rawContent: string): EnvelopeIds {
  const { delimiters, isaStart } = detectDelimiters(rawContent);

  // ISA occupies the fixed-width region up to (not including) the terminator.
  const isaSegment = rawContent.slice(isaStart, isaStart + SEGMENT_TERM_OFFSET);
  const isaFields = isaSegment.split(delimiters.element);
  // ISA has 16 elements after the "ISA" tag → 17 fields including the tag.
  if (isaFields.length < 17) {
    throw new EdiParseError(
      `ISA segment has ${isaFields.length} fields; expected at least 17.`,
      'MALFORMED',
    );
  }

  const isaControlNumber = isaFields[13]!.trim();
  if (isaControlNumber.length === 0) {
    throw new EdiParseError('ISA13 (interchange control number) is empty.', 'MALFORMED');
  }
  const senderId = isaFields[6]!.trim();
  const receiverId = isaFields[8]!.trim();

  // GS06 lives in the first GS segment, if present.
  let gsControlNumber = '';
  const segments = rawContent.split(delimiters.segment);
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (trimmed.startsWith(`GS${delimiters.element}`)) {
      const gsFields = trimmed.split(delimiters.element);
      gsControlNumber = (gsFields[6] ?? '').trim();
      break;
    }
  }

  return { isaControlNumber, gsControlNumber, senderId, receiverId, delimiters };
}
