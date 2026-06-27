import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LifecycleEvent } from '@edi/shared';
import { computeSlaSummary } from '../src/services/sla-summary.js';

const now = new Date('2026-06-20T12:00:00Z');

test('computeSlaSummary flags overdue outbound doc', () => {
  const events: LifecycleEvent[] = [{
    kind: 'transaction',
    transactionSetId: '810',
    direction: 'outbound',
    status: 'received',
    transactionId: 't-1',
    rawFileId: 'rf-1',
    controlNumber: '1',
    ingestedAt: '2026-06-20T10:00:00Z',
    ackStatus: null,
    ackedByTransactionId: null,
    rejectionSummary: null,
    rejectionDetails: null,
    outboundStage: 'transmitted',
    partnerChannel: null,
    isaControlNumber: '0001',
    source: 'upload',
    instanceIndex: null,
    headerSummary: null,
  }];
  const summary = computeSlaSummary(events, [{ setId: '810', direction: 'outbound', withinMinutes: 60 }], now);
  assert.ok(summary);
  assert.equal(summary!.breached, true);
  assert.match(summary!.label, /overdue 60m/);
});
