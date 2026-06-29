import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandAuthorizedPartyOrigins } from '../src/services/auth.js';

test('expandAuthorizedPartyOrigins mirrors localhost and 127.0.0.1', () => {
  assert.deepEqual(expandAuthorizedPartyOrigins(['http://localhost:3000']), [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  assert.deepEqual(expandAuthorizedPartyOrigins(['http://127.0.0.1:3000']), [
    'http://127.0.0.1:3000',
    'http://localhost:3000',
  ]);
});
