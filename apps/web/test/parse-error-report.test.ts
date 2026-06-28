import { test, expect } from 'vitest';
import { buildParseErrorReport, parseErrorHints } from '../src/lib/parse-error-report.ts';

test('parseErrorHints extracts transaction set and segment ids', () => {
  const hints = parseErrorHints('860 is missing its BCH (purchase order change header) segment.');
  expect(hints.transactionSet).toBe('860');
  expect(hints.segments).toContain('BCH');
});

test('buildParseErrorReport includes structured fields and partner dictionary hint', () => {
  const report = buildParseErrorReport({
    id: 'rf-99',
    s3Key: 'k',
    fileHash: 'h',
    isaControlNumber: '000000123',
    source: 'upload',
    status: 'PARSE_ERROR',
    errorMessage: '875 is missing the Purchase Order Number (BPO02).',
    ingestedAt: '2026-06-18T10:00:00.000Z',
  });
  expect(report).toMatch(/rawFileId: rf-99/);
  expect(report).toMatch(/transactionSet: 875/);
  expect(report).toMatch(/segmentHints:.*BPO/);
  expect(report).toMatch(/\/partners/);
});
