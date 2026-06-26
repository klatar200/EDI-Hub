import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewerVersion } from '../src/version-compare.js';

test('isNewerVersion compares numeric semver cores', () => {
  assert.equal(isNewerVersion('0.0.15-alpha', '0.0.14-alpha'), true);
  assert.equal(isNewerVersion('0.0.14-alpha', '0.0.15-alpha'), false);
  assert.equal(isNewerVersion('0.0.14-alpha', '0.0.14-beta'), false);
  assert.equal(isNewerVersion('0.1.0', '0.0.99'), true);
});
