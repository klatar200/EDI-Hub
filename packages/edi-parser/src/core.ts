/**
 * Core X12 primitives shared by the envelope reader and the decomposer:
 * delimiter detection, the parse-error type, and the ISA fixed-offset
 * constants. No dependencies — easy to unit-test in isolation.
 */

/** Delimiters discovered from the ISA segment (never hardcoded). */
export interface Delimiters {
  /** Data element separator — ISA position 3. */
  element: string;
  /** Component (sub-element) separator — ISA position 104. */
  subElement: string;
  /** Segment terminator — the character immediately after ISA16. */
  segment: string;
}

/**
 * Why parsing failed.
 *  - `NOT_X12`   — the input isn't X12 at all (no ISA where one is expected).
 *  - `MALFORMED` — an ISA is present but cannot be parsed (truncated, bad
 *                  field count, implausible delimiter, empty control number).
 * Callers map these to UNRECOGNIZED_FORMAT vs PARSE_ERROR respectively.
 */
export type EdiParseErrorKind = 'NOT_X12' | 'MALFORMED';

/** Thrown when the input is not a parseable X12 ISA envelope. */
export class EdiParseError extends Error {
  readonly code = 'EDI_PARSE_ERROR';
  readonly kind: EdiParseErrorKind;
  constructor(message: string, kind: EdiParseErrorKind) {
    super(message);
    this.name = 'EdiParseError';
    this.kind = kind;
  }
}

// A well-formed ISA segment is a fixed 106 characters: "ISA" + 16 elements,
// with the segment terminator at offset 105. We rely on these fixed offsets to
// discover the delimiters rather than assuming any particular character.
export const ISA_SEGMENT_LENGTH = 106;
const ELEMENT_SEP_OFFSET = 3;
const SUBELEMENT_SEP_OFFSET = 104;
const SEGMENT_TERM_OFFSET = 105;

export interface DetectedDelimiters {
  delimiters: Delimiters;
  /** Index where the ISA segment begins (tolerates a BOM / leading whitespace). */
  isaStart: number;
}

/**
 * Discover the three X12 delimiters from the ISA segment's fixed offsets.
 * Throws {@link EdiParseError} if no plausible ISA is present.
 */
export function detectDelimiters(rawContent: string): DetectedDelimiters {
  const isaStart = rawContent.indexOf('ISA');
  if (isaStart < 0 || isaStart > 8) {
    throw new EdiParseError('No ISA segment found at the start of the input.', 'NOT_X12');
  }
  if (rawContent.length < isaStart + ISA_SEGMENT_LENGTH) {
    throw new EdiParseError('Input is too short to contain a complete ISA segment.', 'MALFORMED');
  }

  const element = rawContent[isaStart + ELEMENT_SEP_OFFSET]!;
  const subElement = rawContent[isaStart + SUBELEMENT_SEP_OFFSET]!;
  const segment = rawContent[isaStart + SEGMENT_TERM_OFFSET]!;

  // An alphanumeric element separator almost certainly means the ISA is
  // malformed (e.g. truncated), so refuse rather than mis-parse.
  if (/[A-Za-z0-9]/.test(element)) {
    throw new EdiParseError(`Implausible element separator: ${JSON.stringify(element)}`, 'MALFORMED');
  }

  return { delimiters: { element, subElement, segment }, isaStart };
}
