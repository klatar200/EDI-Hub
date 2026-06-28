/**
 * SEC-C1 — LAN API token verification.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lanTokenConfigured, verifyLanApiToken } from '../src/services/lan-auth.js';

test('lanTokenConfigured requires at least 32 characters', () => {
  assert.equal(lanTokenConfigured(''), false);
  assert.equal(lanTokenConfigured('short'), false);
  assert.equal(lanTokenConfigured('a'.repeat(32)), true);
});

test('verifyLanApiToken accepts matching tokens and rejects mismatches', () => {
  const token = 'desktop-lan-secret-token-32chars!!';
  assert.equal(verifyLanApiToken(token, token), true);
  assert.equal(verifyLanApiToken('wrong-token', token), false);
});
