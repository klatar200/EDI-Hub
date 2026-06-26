import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDownloadPercent } from '../src/auto-update-progress.js';

test('mergeDownloadPercent keeps the bar monotonic when percent snaps back', () => {
  const first = mergeDownloadPercent(0, 100);
  assert.equal(first.peakPercent, 100);

  const retry = mergeDownloadPercent(first.peakPercent, 4);
  assert.equal(retry.peakPercent, 100);
  assert.equal(retry.hint, 'Finishing download…');
});

test('mergeDownloadPercent advances normally', () => {
  const mid = mergeDownloadPercent(40, 55);
  assert.equal(mid.peakPercent, 55);
  assert.equal(mid.hint, undefined);
});
