import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldLogDownloadProgress } from '../src/update-log-throttle.js';

test('shouldLogDownloadProgress logs first sample and 5% buckets', () => {
  assert.equal(shouldLogDownloadProgress(0, -1, 0, 1000), true);
  assert.equal(shouldLogDownloadProgress(4, 0, 1000, 1500), false);
  assert.equal(shouldLogDownloadProgress(5, 0, 1000, 1500), true);
});

test('shouldLogDownloadProgress logs completion at 100%', () => {
  assert.equal(shouldLogDownloadProgress(100, 95, 0, 5000), true);
});

test('shouldLogDownloadProgress logs at least every 2s', () => {
  assert.equal(shouldLogDownloadProgress(3, 2, 1000, 2999), false);
  assert.equal(shouldLogDownloadProgress(3, 2, 1000, 3000), true);
});
