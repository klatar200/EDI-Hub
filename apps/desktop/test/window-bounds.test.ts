/**
 * UR4/R27 — window bounds persistence tests.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  DEFAULT_WINDOW_BOUNDS,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  loadWindowBounds,
  normalizeWindowBounds,
  saveWindowBounds,
} from '../src/window-bounds.js';

describe('window-bounds', () => {
  it('clamps dimensions to minimum supported size', () => {
    const normalized = normalizeWindowBounds({ width: 400, height: 300 });
    assert.equal(normalized.width, WINDOW_MIN_WIDTH);
    assert.equal(normalized.height, WINDOW_MIN_HEIGHT);
  });

  it('round-trips save and load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edi-hub-bounds-'));
    try {
      saveWindowBounds(dir, { width: 1400, height: 900, x: 12, y: 24, isMaximized: true });
      const loaded = loadWindowBounds(dir);
      assert.equal(loaded.width, 1400);
      assert.equal(loaded.height, 900);
      assert.equal(loaded.x, 12);
      assert.equal(loaded.y, 24);
      assert.equal(loaded.isMaximized, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns defaults when file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edi-hub-bounds-empty-'));
    try {
      const loaded = loadWindowBounds(dir);
      assert.deepEqual(loaded, DEFAULT_WINDOW_BOUNDS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
