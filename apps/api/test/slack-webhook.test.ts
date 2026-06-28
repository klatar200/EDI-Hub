/**
 * Slack webhook SSRF guard tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedSlackWebhookUrl, assertAllowedSlackWebhookUrl } from '../src/services/slack-webhook.js';
import { validatePartnerInput } from '../src/services/partners.js';

test('isAllowedSlackWebhookUrl accepts hooks.slack.com', () => {
  assert.equal(
    isAllowedSlackWebhookUrl('https://hooks.slack.com/services/T1/B1/secret'),
    true,
  );
});

test('isAllowedSlackWebhookUrl rejects internal/metadata targets', () => {
  assert.equal(isAllowedSlackWebhookUrl('http://hooks.slack.com/x'), false);
  assert.equal(isAllowedSlackWebhookUrl('https://169.254.169.254/'), false);
  assert.equal(isAllowedSlackWebhookUrl('https://evil.example.com/hook'), false);
});

test('validatePartnerInput rejects non-Slack webhook URLs', () => {
  assert.throws(
    () =>
      validatePartnerInput({
        displayName: 'Acme',
        isaSenderIds: ['ACME'],
        isaReceiverIds: ['US'],
        contacts: [{ name: 'A', email: 'a@acme.com', role: 'ops', slackWebhook: 'https://evil.example.com' }],
      }),
    /slackWebhook/,
  );
});

test('assertAllowedSlackWebhookUrl throws on bad URL', () => {
  assert.throws(() => assertAllowedSlackWebhookUrl('ftp://hooks.slack.com/x'));
});
