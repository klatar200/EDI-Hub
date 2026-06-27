/**
 * PS-9 — lifecycle export format + route tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LifecycleResponse } from '@edi/shared';
import {
  groupDuplicateEvents,
  lifecycleToCsv,
  lifecycleToPdf,
  lifecycleToTxt,
} from '../src/services/lifecycle-export-format.js';
import { buildServer } from '../src/server.js';
import type { AppConfig } from '../src/config.js';
import type { S3Client } from '@aws-sdk/client-s3';

const SAMPLE: LifecycleResponse = {
  po: 'PO-100',
  enteredBy: { kind: 'po', value: 'PO-100' },
  flow: 'standard',
  partner: { id: 'p-1', displayName: 'Acme', slaCountdownEnabled: false, slaWindows: [] },
  events: [
    {
      kind: 'transaction',
      transactionSetId: '850',
      direction: 'inbound',
      status: 'received',
      transactionId: 't-1',
      rawFileId: 'r-1',
      controlNumber: 'C1',
      ingestedAt: '2026-06-01T10:00:00.000Z',
      ackStatus: null,
      ackedByTransactionId: null,
      rejectionSummary: null,
      rejectionDetails: null,
      outboundStage: null,
      partnerChannel: null,
      isaControlNumber: '000000001',
      source: 'upload',
      instanceIndex: 1,
      headerSummary: null,
    },
    {
      kind: 'gap',
      transactionSetId: '856',
      direction: 'outbound',
      status: 'expected_missing',
      transactionId: null,
      rawFileId: null,
      controlNumber: null,
      ingestedAt: null,
      ackStatus: null,
      ackedByTransactionId: null,
      rejectionSummary: null,
      rejectionDetails: null,
      outboundStage: null,
      partnerChannel: null,
      isaControlNumber: null,
      source: null,
      instanceIndex: null,
      headerSummary: null,
    },
  ],
};

test('lifecycleToTxt includes PO and document lines', () => {
  const txt = lifecycleToTxt(SAMPLE);
  assert.match(txt, /Lifecycle: PO-100/);
  assert.match(txt, /Partner: Acme/);
  assert.match(txt, /\[850\]/);
  assert.match(txt, /EXPECTED MISSING/);
});

test('lifecycleToCsv emits header and event rows', () => {
  const csv = lifecycleToCsv(SAMPLE);
  assert.match(csv, /^po,setId,direction/);
  assert.match(csv, /PO-100,850,inbound,received/);
  assert.match(csv, /856,outbound,expected_missing,gap/);
});

test('lifecycleToPdf returns PDF magic bytes', () => {
  const pdf = lifecycleToPdf(SAMPLE);
  assert.match(pdf.toString('utf8', 0, 8), /^%PDF-1\./);
});

test('groupDuplicateEvents returns only groups with 2+ copies', () => {
  const dup = groupDuplicateEvents([
    ...SAMPLE.events,
    {
      ...SAMPLE.events[0]!,
      transactionId: 't-2',
      rawFileId: 'r-2',
      controlNumber: 'C2',
      instanceIndex: 2,
    },
  ]);
  assert.equal(dup.length, 1);
  assert.equal(dup[0]!.length, 2);
});

const config = {
  port: 0, nodeEnv: 'test', maxFileSizeBytes: 1024 * 1024,
  s3: { bucket: 'b', region: 'us-east-1', endpoint: 'http://localhost:9000', forcePathStyle: true },
  retry: { maxAttempts: 1, baseDelayMs: 1 },
  sftp: { enabled: false, watchDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
  as2: { enabled: false, inboxDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
  ourIsaIds: ['US'],
  notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
  clerk: { secretKey: '', webhookSecret: '' },
  storage: { backend: 's3', localDataDir: '/tmp/edi-test' },
  alertSuppressionMinutes: 60,
  cors: { allowedOrigins: [] },
  webStatic: { dir: '' },
} as AppConfig;

const fakeS3 = { config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) }, async send() { return {}; } } as unknown as S3Client;

test('GET /lifecycles/:po/export rejects bad format', async () => {
  const app = await buildServer({ config, s3: fakeS3 });
  const res = await app.inject({
    method: 'GET',
    url: '/api/lifecycles/PO-100/export?format=xml',
    headers: { 'x-tenant-id': '00000000-0000-0000-0000-000000000001' },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});
