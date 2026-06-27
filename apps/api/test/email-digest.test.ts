/**
 * PS-11 — email digest schedule + handler tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { tenantContext } from '@edi/db';
import { msUntilDigestHour } from '../src/jobs/email-digest-schedule.js';
import {
  createEmailDigestHandler,
  EMAIL_DIGEST_JOB_NAME,
} from '../src/jobs/handlers/email-digest.js';

test('msUntilDigestHour returns positive delay', () => {
  const from = new Date('2026-06-25T10:00:00.000Z');
  const delay = msUntilDigestHour(8, from);
  assert.ok(delay > 0);
  assert.ok(delay <= 24 * 60 * 60 * 1000);
});

test('email digest handler writes preview audit when enabled', async () => {
  const PILOT = '00000000-0000-0000-0000-000000000001';
  const audits: unknown[] = [];
  const prisma = {
    tenant: {
      findUnique: async () => ({
        settings: {
          emailDigestEnabled: true,
          emailDigestHourUtc: 8,
          staleTrafficWindowHours: 6,
          slaCountdownEnabled: false,
          quietHoursStart: null,
          quietHoursEnd: null,
        },
      }),
    },
    alert: { count: async () => 2 },
    rawFile: { count: async () => 1 },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        auditEvent: {
          create: async ({ data }: { data: unknown }) => {
            audits.push(data);
          },
        },
      });
    },
  } as unknown as PrismaClient;

  const handler = createEmailDigestHandler({ prisma, previewMode: true });
  await tenantContext.run({ tenantId: PILOT }, async () => {
    await handler({ tenantId: PILOT });
  });
  assert.equal(audits.length, 1);
});

test('EMAIL_DIGEST_JOB_NAME is registered constant', () => {
  assert.equal(EMAIL_DIGEST_JOB_NAME, 'email-digest');
});
