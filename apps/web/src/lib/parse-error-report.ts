/**
 * PB-2 F60 — structured parse-error report for ops tickets.
 */
import type { RawFileRecord } from '@edi/shared';

const SET_RE = /\b(850|855|856|860|875|880|810|997|999)\b/;
const SEGMENT_RE = /\b([A-Z]{2,3}\d{0,2})\b/g;
const PAREN_SEGMENT_RE = /\(([A-Z]{2,3}\d{0,2})\)/g;

export function parseErrorHints(errorMessage: string): { transactionSet?: string; segments: string[] } {
  const transactionSet = errorMessage.match(SET_RE)?.[1];
  const segments = new Set<string>();
  for (const m of errorMessage.matchAll(SEGMENT_RE)) {
    const s = m[1]!;
    if (s.length >= 2 && s.length <= 5 && !SET_RE.test(s)) segments.add(s.replace(/\d+$/, '') || s);
  }
  for (const m of errorMessage.matchAll(PAREN_SEGMENT_RE)) {
    const s = m[1]!;
    segments.add(s.replace(/\d+$/, '') || s);
  }
  return { transactionSet, segments: [...segments] };
}

/** Plain-text block suitable for clipboard / support tickets. */
export function buildParseErrorReport(file: RawFileRecord): string {
  const err = file.errorMessage ?? '';
  const hints = parseErrorHints(err);
  const lines = [
    '# EDI Hub parse error report',
    `rawFileId: ${file.id}`,
    `isaControlNumber: ${file.isaControlNumber ?? 'n/a'}`,
    `source: ${file.source}`,
    `status: ${file.status}`,
    `ingestedAt: ${file.ingestedAt}`,
  ];
  if (hints.transactionSet) lines.push(`transactionSet: ${hints.transactionSet}`);
  if (hints.segments.length > 0) lines.push(`segmentHints: ${hints.segments.join(', ')}`);
  lines.push(
    '',
    'error:',
    err || '(no message recorded)',
    '',
    'nextSteps:',
    '- Review segment label overrides: /partners (dictionary tab per partner)',
    '- Re-run parse after fixing the file or partner config',
  );
  return lines.join('\n');
}
