/**
 * Phase 6 Sprint 2 — partner-specific ack-code override overlay.
 *
 * The parser stores X12 spec wording in each AK3/AK4 entry's `syntaxErrorMessage`
 * at decode time (Phase 5). At response time, when we know which partner an
 * interchange came from, we can replace those default strings with the
 * partner's preferred phrasing — without re-parsing the original 997.
 *
 * Empty overrides → identical output to today (Phase 5 X12 defaults pass
 * through unchanged).
 */
import type {
  AckCodeOverrides,
  RejectionSegmentError,
} from '@edi/shared';

/** Apply a partner's ack-code overrides to a structured rejection tree.
 *  Returns a new array; never mutates input. */
export function applyAckOverrides(
  details: RejectionSegmentError[] | null,
  overrides: AckCodeOverrides | null | undefined,
): RejectionSegmentError[] | null {
  if (!details) return null;
  if (!overrides) return details;
  const segOverride = overrides.AK304 ?? {};
  const elOverride = overrides.AK403 ?? {};
  // Avoid allocating new objects when nothing applies.
  const hasSegOverrides = Object.keys(segOverride).length > 0;
  const hasElOverrides = Object.keys(elOverride).length > 0;
  if (!hasSegOverrides && !hasElOverrides) return details;
  return details.map((seg) => {
    const overridden = hasSegOverrides ? segOverride[seg.syntaxErrorCode] : undefined;
    const nextSeg: RejectionSegmentError = {
      ...seg,
      syntaxErrorMessage: overridden ?? seg.syntaxErrorMessage,
      elementErrors: seg.elementErrors.map((el) => {
        const elOverridden = hasElOverrides ? elOverride[el.syntaxErrorCode] : undefined;
        return {
          ...el,
          syntaxErrorMessage: elOverridden ?? el.syntaxErrorMessage,
        };
      }),
    };
    return nextSeg;
  });
}

/** Apply an override to a transaction-set ack code (AK501) — used when the
 *  caller wants to re-decode a status code rather than reuse the parser's
 *  stored statusMessage. */
export function overrideTransactionAck(
  code: string,
  overrides: AckCodeOverrides | null | undefined,
): string | null {
  if (!overrides?.AK501) return null;
  return overrides.AK501[code] ?? null;
}

/** Apply an override to a group ack code (AK901). */
export function overrideGroupAck(
  code: string,
  overrides: AckCodeOverrides | null | undefined,
): string | null {
  if (!overrides?.AK901) return null;
  return overrides.AK901[code] ?? null;
}
