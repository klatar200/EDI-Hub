import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT_SECURITY_POLICY } from '@edi/shared/csp';

test('CSP allows Clerk JS and Google Fonts required by the SPA', () => {
  assert.match(CONTENT_SECURITY_POLICY, /script-src[^;]*\*\.clerk\.accounts\.dev/);
  assert.match(CONTENT_SECURITY_POLICY, /connect-src[^;]*clerk-telemetry\.com/);
  assert.match(CONTENT_SECURITY_POLICY, /style-src[^;]*fonts\.googleapis\.com/);
  assert.match(CONTENT_SECURITY_POLICY, /font-src[^;]*fonts\.gstatic\.com/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-src[^;]*challenges\.cloudflare\.com/);
});
