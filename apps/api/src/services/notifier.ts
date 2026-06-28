/**
 * Phase 7 Sprint 2 — alert notifier.
 *
 * Three-mode delivery (Gate E + Q8):
 *   disabled — no-op; useful for tests / CI.
 *   preview  — write a `previewTrail` entry to the alert's sourceRef so the
 *              UI can show what *would* have been delivered. No external
 *              calls. Default during the first week of Sprint 2 rollout.
 *   live     — real SES email + Slack webhook POSTs. Requires a verified SES
 *              sender configured via SES_FROM.
 *
 * Routing: per-partner contacts with optional `slackWebhook` and optional
 * `alertTypeOptIns`. A contact with no opt-ins receives every alert type;
 * the optional `GLOBAL_SLACK_WEBHOOK` env covers cases where no partner
 * contact has a webhook.
 *
 * No retries here — pilot scale tolerates lost deliveries since the next
 * detection pass re-emits. Sprint 3 can add backoff if needed.
 */
import type { PrismaClient } from '@prisma/client';
import { tenantContext } from '@edi/db';
import type {
  AlertRecord,
  AlertType,
  PartnerContact,
  PreviewTrailEntry,
} from '@edi/shared';
import type { NotifierConfig } from '../config.js';
import { readTenantSettings } from './tenant-settings.js';
import { isInQuietHours } from './quiet-hours.js';
import { isAllowedSlackWebhookUrl } from './slack-webhook.js';

export interface NotifierDeps {
  prisma: PrismaClient;
  config: NotifierConfig;
  /** Override the SES sender; defaults to fetch from AWS SDK at first use. */
  sendEmail?: (input: SendEmailInput) => Promise<void>;
  /** Override Slack delivery for tests. */
  postSlack?: (webhookUrl: string, payload: SlackPayload) => Promise<void>;
  /** Test-only clock. */
  now?: () => Date;
}

export interface SendEmailInput {
  from: string;
  to: string[];
  subject: string;
  body: string;
}

export interface SlackPayload {
  text: string;
  attachments?: Array<{ color: string; text: string }>;
}

export interface NotifyResult {
  /** Channels we attempted (or would have attempted in preview mode). */
  recipients: Array<{ channel: 'email' | 'slack'; recipient: string }>;
  /** True only when at least one channel actually delivered (live mode). */
  delivered: boolean;
}

interface PartnerLite {
  id: string;
  displayName: string;
  contacts: PartnerContact[];
}

/** Return only contacts opted into this alert type. Empty opt-ins = all. */
function eligibleContacts(contacts: PartnerContact[], type: AlertType): PartnerContact[] {
  return contacts.filter((c) => !c.alertTypeOptIns || c.alertTypeOptIns.length === 0 || c.alertTypeOptIns.includes(type));
}

function emailSubject(alert: AlertRecord): string {
  const sevTag = alert.severity === 'critical' ? '[CRITICAL] ' : alert.severity === 'info' ? '[INFO] ' : '';
  return `${sevTag}${alert.title}`;
}

function emailBody(alert: AlertRecord): string {
  return [
    alert.body,
    '',
    `Type:     ${alert.type}`,
    `Severity: ${alert.severity}`,
    `Created:  ${alert.createdAt}`,
    `Last seen: ${alert.lastSeenAt}`,
    '',
    'Sent by EDI Data Hub.',
  ].join('\n');
}

function slackPayload(alert: AlertRecord): SlackPayload {
  const color = alert.severity === 'critical' ? 'danger' : alert.severity === 'info' ? 'good' : 'warning';
  return {
    text: alert.title,
    attachments: [{ color, text: alert.body }],
  };
}

/** Default SES sender — lazy-loaded so disabled/preview modes don't pay the
 *  AWS SDK init cost. Throws if SES_FROM is empty. */
async function defaultSendEmail(config: NotifierConfig, input: SendEmailInput): Promise<void> {
  if (!input.from || input.from.length === 0) {
    throw new Error('SES_FROM is empty; cannot send live email. Switch NOTIFIER_MODE to preview until a sender is verified.');
  }
  // Defer the AWS SDK import so disabled/preview never pull it in.
  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
  const client = new SESClient({ region: config.sesRegion });
  await client.send(
    new SendEmailCommand({
      Source: input.from,
      Destination: { ToAddresses: input.to },
      Message: {
        Subject: { Data: input.subject },
        Body: { Text: { Data: input.body } },
      },
    }),
  );
}

async function defaultPostSlack(webhookUrl: string, payload: SlackPayload): Promise<void> {
  if (!isAllowedSlackWebhookUrl(webhookUrl)) {
    throw new Error('Slack webhook URL is not on the allowlist');
  }
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`);
}

/**
 * Notify on a single alert. Idempotent in preview mode (`previewTrail` rows
 * accumulate, one per detection pass that re-emits). In live mode, each
 * call is one delivery attempt.
 */
export async function notify(
  deps: NotifierDeps,
  alert: AlertRecord,
  partner: PartnerLite | null,
): Promise<NotifyResult> {
  const mode = deps.config.mode;
  if (mode === 'disabled') return { recipients: [], delivered: false };

  const now = (deps.now ?? (() => new Date()))();
  try {
    const settings = await readTenantSettings(deps.prisma, tenantContext.requireTenantId());
    if (isInQuietHours(now, settings.quietHoursStart, settings.quietHoursEnd)) {
      return { recipients: [], delivered: false };
    }
  } catch {
    // No tenant context (some tests) — skip quiet-hours gate.
  }

  const contacts = partner ? eligibleContacts(partner.contacts, alert.type) : [];
  const emailTargets = contacts.map((c) => c.email).filter((e) => e.length > 0);
  const slackTargets = contacts
    .map((c) => c.slackWebhook)
    .filter((u): u is string => typeof u === 'string' && isAllowedSlackWebhookUrl(u));
  if (
    slackTargets.length === 0 &&
    deps.config.globalSlackWebhook.length > 0 &&
    isAllowedSlackWebhookUrl(deps.config.globalSlackWebhook)
  ) {
    slackTargets.push(deps.config.globalSlackWebhook);
  }

  const recipients: NotifyResult['recipients'] = [
    ...emailTargets.map((e) => ({ channel: 'email' as const, recipient: e })),
    ...slackTargets.map((u) => ({ channel: 'slack' as const, recipient: u })),
  ];

  if (mode === 'preview') {
    if (recipients.length === 0) return { recipients, delivered: false };
    const trail: PreviewTrailEntry[] = recipients.map((r) => ({
      channel: r.channel,
      recipient: r.recipient,
      at: now.toISOString(),
    }));
    const existing = (alert.sourceRef.previewTrail as PreviewTrailEntry[] | undefined) ?? [];
    const merged = [...existing, ...trail];
    await deps.prisma.alert.update({
      where: { id: alert.id },
      data: { sourceRef: { ...alert.sourceRef, previewTrail: merged } as never },
    });
    return { recipients, delivered: false };
  }

  // live mode
  const sendEmail = deps.sendEmail ?? ((i: SendEmailInput) => defaultSendEmail(deps.config, i));
  const postSlack = deps.postSlack ?? defaultPostSlack;

  let delivered = false;
  if (emailTargets.length > 0) {
    try {
      await sendEmail({
        from: deps.config.sesFrom,
        to: emailTargets,
        subject: emailSubject(alert),
        body: emailBody(alert),
      });
      delivered = true;
    } catch (err) {
      // Pilot scale: log + drop. Next detection pass re-emits.
      console.warn(`notifier: email delivery failed for alert ${alert.id}:`, err);
    }
  }
  for (const url of slackTargets) {
    try {
      await postSlack(url, slackPayload(alert));
      delivered = true;
    } catch (err) {
      console.warn(`notifier: slack delivery failed for alert ${alert.id}:`, err);
    }
  }
  return { recipients, delivered };
}
