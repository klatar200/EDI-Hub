/**
 * Slack incoming-webhook URL validation — blocks SSRF via partner contacts.
 */

const ALLOWED_HOSTS = new Set(['hooks.slack.com', 'hooks.slack-gov.com']);

/** Returns true when `url` is a permitted Slack incoming-webhook HTTPS URL. */
export function isAllowedSlackWebhookUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (!ALLOWED_HOSTS.has(parsed.hostname)) return false;
  if (parsed.username || parsed.password) return false;
  if (!parsed.pathname.startsWith('/')) return false;
  return true;
}

/** Throws when the URL is not an allowed Slack webhook. */
export function assertAllowedSlackWebhookUrl(url: string): void {
  if (!isAllowedSlackWebhookUrl(url)) {
    throw new Error('slackWebhook must be an HTTPS Slack incoming webhook (hooks.slack.com).');
  }
}
