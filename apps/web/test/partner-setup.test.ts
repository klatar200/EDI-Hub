import { test, expect } from 'vitest';
import { partnerSetupStatus } from '@edi/shared';

test('partnerSetupStatus reports ready when fully configured', () => {
  const r = partnerSetupStatus({ isaSenderIds: ['X'], slaWindows: [{}], contacts: [{}] });
  expect(r.status).toBe('ready');
  expect(r.gaps).toHaveLength(0);
  expect(r.doneCount).toBe(3);
});

test('partnerSetupStatus flags missing ISA senders as an error', () => {
  const r = partnerSetupStatus({ isaSenderIds: [], slaWindows: [{}], contacts: [{}] });
  expect(r.status).toBe('error');
  expect(r.gaps.map((g) => g.id)).toContain('isaSenders');
});

test('partnerSetupStatus warns when SLA windows are missing (missing-ack alerts skipped)', () => {
  const r = partnerSetupStatus({ isaSenderIds: ['X'], slaWindows: [], contacts: [{}] });
  expect(r.status).toBe('warn');
  expect(r.gaps.map((g) => g.id)).toEqual(['slaWindows']);
});

test('partnerSetupStatus surfaces worst severity and orders gaps error-first', () => {
  const r = partnerSetupStatus({ isaSenderIds: [], slaWindows: [], contacts: [] });
  expect(r.status).toBe('error');
  expect(r.gaps.map((g) => g.id)).toEqual(['isaSenders', 'slaWindows', 'contacts']);
  expect(r.doneCount).toBe(0);
});
