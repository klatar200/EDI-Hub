/**
 * Transaction read API tests — typed interpretation + labeled tree + lookup by
 * business key. Seeds an in-memory Prisma fake with stored rows (as they would
 * exist after parseAndStore) and exercises the routes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { buildServer } from '../src/server.js';
import type { AppConfig } from '../src/config.js';

const config = {
  port: 0, nodeEnv: 'test', maxFileSizeBytes: 1024 * 1024,
  s3: { bucket: 'b', region: 'us-east-1', endpoint: 'http://localhost:9000', forcePathStyle: true },
  retry: { maxAttempts: 1, baseDelayMs: 1 },
  sftp: { enabled: false, watchDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
  as2: { enabled: false, inboxDir: '', processedDir: '', failedDir: '', stabilityThresholdMs: 1 },
  ourIsaIds: [],
  notifier: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
  clerk: { secretKey: '', webhookSecret: '' },
  storage: { backend: 's3', localDataDir: '/tmp/edi-test' },
  alertSuppressionMinutes: 60,
    lanApiToken: '',
  cors: { allowedOrigins: [] },
  webStatic: { dir: "" },
} as AppConfig;

const fakeS3 = { config: { requestHandler: {}, maxAttempts: 1, endpointProvider: () => ({ url: new URL('http://localhost:9000') }) }, async send() { return {}; } } as unknown as S3Client;

// One stored 850 transaction (PO-12345) with two line items, labeled.
const txnRow = {
  id: 'txn-1',
  functionalGroupId: 'g1',
  transactionSetId: '850',
  controlNumber: '0001',
  declaredSegmentCount: 5,
  segmentCount: 5,
  poNumber: 'PO-12345',
  invoiceNumber: null,
  purpose: '00',
  segments: [
    { tag: 'ST', position: 0, elements: [{ index: 1, value: '850', semanticLabel: 'Transaction Set Identifier Code' }, { index: 2, value: '0001', semanticLabel: 'Transaction Set Control Number' }] },
    { tag: 'BEG', position: 1, elements: [
      { index: 1, value: '00', semanticLabel: 'Transaction Set Purpose Code' },
      { index: 2, value: 'SA', semanticLabel: 'Purchase Order Type Code' },
      { index: 3, value: 'PO-12345', semanticLabel: 'Purchase Order Number' },
      { index: 5, value: '20260115', semanticLabel: 'Purchase Order Date' },
    ] },
    { tag: 'PO1', position: 2, elements: [
      { index: 1, value: '1', semanticLabel: 'Assigned Identification' },
      { index: 2, value: '10', semanticLabel: 'Quantity Ordered' },
      { index: 3, value: 'EA', semanticLabel: 'Unit or Basis for Measurement' },
      { index: 4, value: '25.00', semanticLabel: 'Unit Price' },
      { index: 6, value: 'VP', semanticLabel: 'Product/Service ID Qualifier' },
      { index: 7, value: 'VENDPART1', semanticLabel: 'Product/Service ID' },
    ] },
    { tag: 'PO1', position: 3, elements: [
      { index: 1, value: '2', semanticLabel: 'Assigned Identification' },
      { index: 2, value: '5', semanticLabel: 'Quantity Ordered' },
      { index: 3, value: 'CA', semanticLabel: 'Unit or Basis for Measurement' },
      { index: 4, value: '40.00', semanticLabel: 'Unit Price' },
      { index: 7, value: 'VENDPART2', semanticLabel: 'Product/Service ID' },
    ] },
    { tag: 'SE', position: 4, elements: [{ index: 1, value: '5', semanticLabel: 'Number of Included Segments' }] },
  ],
};

function fakePrisma(): PrismaClient {
  return {
    rawFile: { async count() { return 0; } },
    transaction: {
      async findUnique({ where }: { where: { id: string } }) { return where.id === txnRow.id ? txnRow : null; },
      async findMany({ where }: { where?: { poNumber?: string; invoiceNumber?: string; transactionSetId?: string } } = {}) {
        const w = where ?? {};
        if (w.poNumber && w.poNumber !== txnRow.poNumber) return [];
        if (w.invoiceNumber) return [];
        if (w.transactionSetId && w.transactionSetId !== txnRow.transactionSetId) return [];
        return [txnRow];
      },
    },
  } as unknown as PrismaClient;
}

test('GET /transactions/:id returns the typed interpretation + labeled tree', async () => {
  const app = await buildServer({ config, s3: fakeS3, prisma: fakePrisma() });
  const res = await app.inject({ method: 'GET', url: '/api/transactions/txn-1' });
  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.equal(body.poNumber, 'PO-12345');
  assert.equal(body.interpreted.type, '850');
  assert.equal(body.interpreted.poNumber, 'PO-12345');
  assert.equal(body.interpreted.poDate, '20260115');
  assert.equal(body.interpreted.lineItems.length, 2);
  assert.equal(body.interpreted.lineItems[0].productId, 'VENDPART1');

  const beg = body.segments.find((s: { tag: string }) => s.tag === 'BEG');
  const beg03 = beg.elements.find((e: { index: number }) => e.index === 3);
  assert.equal(beg03.semanticLabel, 'Purchase Order Number');
  await app.close();
});

test('GET /transactions/:id 404s for an unknown id', async () => {
  const app = await buildServer({ config, s3: fakeS3, prisma: fakePrisma() });
  const res = await app.inject({ method: 'GET', url: '/api/transactions/nope' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'NOT_FOUND');
  await app.close();
});

test('GET /transactions?po= finds by PO number', async () => {
  const app = await buildServer({ config, s3: fakeS3, prisma: fakePrisma() });
  const hit = await app.inject({ method: 'GET', url: '/api/transactions?po=PO-12345' });
  assert.equal(hit.statusCode, 200);
  assert.equal(hit.json().count, 1);
  assert.equal(hit.json().items[0].id, 'txn-1');

  const miss = await app.inject({ method: 'GET', url: '/api/transactions?po=PO-NOPE' });
  assert.equal(miss.json().count, 0);
  await app.close();
});
