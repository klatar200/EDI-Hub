import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInQuietHours } from '../src/services/quiet-hours.js';

test('isInQuietHours respects same-day window', () => {
  const noon = new Date('2026-06-20T12:00:00.000Z');
  assert.equal(isInQuietHours(noon, '09:00', '17:00'), true);
  assert.equal(isInQuietHours(noon, '13:00', '17:00'), false);
});

test('isInQuietHours supports overnight span', () => {
  const late = new Date('2026-06-20T23:30:00.000Z');
  const early = new Date('2026-06-20T05:00:00.000Z');
  assert.equal(isInQuietHours(late, '22:00', '06:00'), true);
  assert.equal(isInQuietHours(early, '22:00', '06:00'), true);
  const midday = new Date('2026-06-20T12:00:00.000Z');
  assert.equal(isInQuietHours(midday, '22:00', '06:00'), false);
});
