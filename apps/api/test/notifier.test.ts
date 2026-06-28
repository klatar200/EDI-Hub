/**
 * Phase 7 Sprint 2 — notifier tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { notify, type SendEmailInput, type SlackPayload } from '../src/services/notifier.js';
import type { NotifierConfig } from '../src/config.js';
import type { AlertRecord, PartnerContact } from '@edi/shared';

function alertOf(over: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id: 'a-1', partnerId: 'p-1', type: 'MISSING_ACK', severity: 'warning',
    title: 'Sysco: 810 outbound missing 997 ack',
    body: 'overdue 65m',
    dedupeKey: 'k-1', sourceRef: {},
    status: 'active',
    createdAt: '2026-06-18T10:00:00.000Z',
    lastSeenAt: '2026-06-18T10:00:00.000Z',
    acknowledgedAt: null, acknowledgedBy: null, suppressUntil: null,
    ...over,
  };
}

function partnerOf(contacts: PartnerContact[]) {
  return { id: 'p-1', displayName: 'Sysco', contacts };
}

const stubPrisma = {
  alert: {
    async update() { return null; },
  },
} as unknown as PrismaClient;

const baseConfig: NotifierConfig = {
  mode: 'disabled', sesFrom: 'noreply@hub.local', sesRegion: 'us-east-1', globalSlackWebhook: '',
};

test('disabled mode is a no-op (no recipients, no delivery)', async () => {
  const r = await notify({ prisma: stubPrisma, config: baseConfig }, alertOf(), partnerOf([
    { name: 'a', email: 'a@partner.com', role: 'ops' },
  ]));
  assert.deepEqual(r.recipients, []);
  assert.equal(r.delivered, false);
});

test('preview mode writes a previewTrail to the alert (no external delivery)', async () => {
  let updated: Record<string, unknown> | null = null;
  const prisma = {
    alert: {
      async update({ data }: { data: Record<string, unknown> }) {
        updated = data;
        return null;
      },
    },
  } as unknown as PrismaClient;
  const r = await notify(
    { prisma, config: { ...baseConfig, mode: 'preview' } },
    alertOf(),
    partnerOf([
      { name: 'Jane', email: 'jane@sysco.com', role: 'ops', slackWebhook: 'https://hooks.slack.com/x' },
    ]),
  );
  assert.equal(r.recipients.length, 2);
  assert.equal(r.delivered, false);
  assert.ok(updated);
  const sr = (updated as { sourceRef: { previewTrail: Array<{ channel: string; recipient: string }> } }).sourceRef;
  assert.equal(sr.previewTrail.length, 2);
  assert.deepEqual(sr.previewTrail.map((t) => t.channel).sort(), ['email', 'slack']);
});

test('live mode routes to email + slack via injected transports', async () => {
  const emails: SendEmailInput[] = [];
  const slacks: Array<{ url: string; payload: SlackPayload }> = [];
  const r = await notify(
    {
      prisma: stubPrisma,
      config: { ...baseConfig, mode: 'live' },
      sendEmail: async (i) => { emails.push(i); },
      postSlack: async (url, payload) => { slacks.push({ url, payload }); },
    },
    alertOf({ severity: 'critical', title: 'Sysco: rejection rate spiked' }),
    partnerOf([
      { name: 'Jane', email: 'jane@sysco.com', role: 'ops', slackWebhook: 'https://hooks.slack.com/T1/B1/X' },
    ]),
  );
  assert.equal(r.delivered, true);
  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0]!.to, ['jane@sysco.com']);
  assert.ok(emails[0]!.subject.includes('CRITICAL'));
  assert.equal(slacks.length, 1);
  assert.equal(slacks[0]!.payload.attachments![0]!.color, 'danger');
});

test('alertTypeOptIns filters contacts: a contact opted out gets nothing', async () => {
  const emails: SendEmailInput[] = [];
  const r = await notify(
    {
      prisma: stubPrisma,
      config: { ...baseConfig, mode: 'live' },
      sendEmail: async (i) => { emails.push(i); },
      postSlack: async () => { /* noop */ },
    },
    alertOf({ type: 'MISSING_ACK' }),
    partnerOf([
      { name: 'A', email: 'a@p.com', role: 'ops', alertTypeOptIns: ['REJECTION_RATE_SPIKE'] },
      { name: 'B', email: 'b@p.com', role: 'ops' }, // no opt-ins = all types
    ]),
  );
  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0]!.to, ['b@p.com']);
  assert.equal(r.recipients.length, 1);
});

test('globalSlackWebhook fallback applies when no contact has slackWebhook', async () => {
  const slacks: string[] = [];
  await notify(
    {
      prisma: stubPrisma,
      config: { ...baseConfig, mode: 'live', globalSlackWebhook: 'https://hooks.slack.com/FALLBACK' },
      sendEmail: async () => { /* noop */ },
      postSlack: async (url) => { slacks.push(url); },
    },
    alertOf(),
    partnerOf([{ name: 'A', email: 'a@p.com', role: 'ops' }]),
  );
  assert.deepEqual(slacks, ['https://hooks.slack.com/FALLBACK']);
});

test('live mode ignores non-allowlisted slack webhooks', async () => {
  const slacks: string[] = [];
  const r = await notify(
    {
      prisma: stubPrisma,
      config: { ...baseConfig, mode: 'live' },
      sendEmail: async () => { /* noop */ },
      postSlack: async (url) => { slacks.push(url); },
    },
    alertOf(),
    partnerOf([{ name: 'A', email: 'a@p.com', role: 'ops', slackWebhook: 'https://evil.example.com/hook' }]),
  );
  assert.equal(slacks.length, 0);
  assert.equal(r.recipients.filter((x) => x.channel === 'slack').length, 0);
});

test('live email failure does not throw; logs and returns delivered=false when nothing else sent', async () => {
  const r = await notify(
    {
      prisma: stubPrisma,
      config: { ...baseConfig, mode: 'live' },
      sendEmail: async () => { throw new Error('SES down'); },
      postSlack: async () => { throw new Error('Slack down'); },
    },
    alertOf(),
    partnerOf([{ name: 'A', email: 'a@p.com', role: 'ops', slackWebhook: 'https://hooks.slack.com/X' }]),
  );
  // The notifier captured both targets and tried both; both threw, so
  // delivered=false. Critically the error didn't propagate.
  assert.equal(r.delivered, false);
  assert.equal(r.recipients.length, 2);
});
