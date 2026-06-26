/**
 * D5 Sprint 1 — shared deterministic fixtures for parity tests.
 *
 * Every parity spec stubs the API at the network level (via
 * `page.route`) so the rendered React tree depends ONLY on canned
 * responses defined here. This is what makes the screenshots stable:
 * a row count drift in the dev database would otherwise produce a
 * 100% pixel diff and a flaky test.
 *
 * The fixtures intentionally mirror the @edi/shared response shapes
 * (a static `as const` would coupling-error if those shapes drift —
 * which is exactly the surface area we want to be loud about). When
 * the shared types change, this file should also change.
 */
import type { Page } from '@playwright/test';

const FIXED_ISO = '2026-01-01T10:00:00.000Z';

/** Canned /api/me. The dev-fallback API pins everything to the pilot
 *  tenant; this matches that role shape. */
const ME = {
  id: 'user-fixture',
  email: 'parity@edihub.test',
  displayName: 'Parity Tester',
  role: 'admin',
  clerkUserId: 'user_fixture',
  createdAt: FIXED_ISO,
  updatedAt: FIXED_ISO,
};

const PARTNERS = {
  partners: ['ACME-FOODS', 'SYSCO'],
};

const PARTNERS_CONFIG = {
  items: [],
};

const TRANSACTIONS = {
  items: [
    {
      id: 'tx-1',
      transactionSetId: '850',
      controlNumber: '0001',
      poNumber: 'PO-12345',
      invoiceNumber: null,
      purpose: 'Purchase Order',
      senderId: 'ACME-FOODS',
      receiverId: 'OURS',
      status: 'PARSED',
      ingestedAt: FIXED_ISO,
      direction: 'outbound',
    },
    {
      id: 'tx-2',
      transactionSetId: '810',
      controlNumber: '0002',
      poNumber: 'PO-12345',
      invoiceNumber: 'INV-A100',
      purpose: 'Invoice',
      senderId: 'SYSCO',
      receiverId: 'OURS',
      status: 'PARSED',
      ingestedAt: FIXED_ISO,
      direction: 'inbound',
    },
  ],
  limit: 25,
  offset: 0,
  count: 2,
};

const LIFECYCLE = {
  po: 'PO-12345',
  enteredBy: { kind: 'po', value: 'PO-12345' },
  flow: 'standard',
  events: [
    {
      kind: 'transaction',
      transactionSetId: '850',
      direction: 'outbound',
      status: 'acknowledged',
      transactionId: 'tx-1',
      rawFileId: 'rf-1',
      controlNumber: '0001',
      ingestedAt: FIXED_ISO,
      ackStatus: null,
      ackedByTransactionId: 'tx-3',
      rejectionSummary: null,
      rejectionDetails: null,
      outboundStage: 'confirmed',
      partnerChannel: 'AS2',
      isaControlNumber: '000000001',
      source: 'as2',
      instanceIndex: null,
    },
    {
      kind: 'transaction',
      transactionSetId: '855',
      direction: 'inbound',
      status: 'received',
      transactionId: 'tx-4',
      rawFileId: 'rf-2',
      controlNumber: '0099',
      ingestedAt: FIXED_ISO,
      ackStatus: null,
      ackedByTransactionId: null,
      rejectionSummary: null,
      rejectionDetails: null,
      outboundStage: null,
      partnerChannel: null,
      isaControlNumber: '000000002',
      source: 'sftp',
      instanceIndex: null,
    },
    {
      kind: 'gap',
      transactionSetId: '856',
      direction: 'inbound',
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
    },
    {
      kind: 'transaction',
      transactionSetId: '810',
      direction: 'inbound',
      status: 'received',
      transactionId: 'tx-2',
      rawFileId: 'rf-3',
      controlNumber: '0002',
      ingestedAt: FIXED_ISO,
      ackStatus: null,
      ackedByTransactionId: null,
      rejectionSummary: null,
      rejectionDetails: null,
      outboundStage: null,
      partnerChannel: null,
      isaControlNumber: '000000003',
      source: 'upload',
      instanceIndex: null,
    },
  ],
};

const ALERTS = {
  items: [
    {
      id: 'alert-1',
      partnerId: 'partner-acme',
      type: 'MISSING_ACK',
      severity: 'warning',
      title: 'Missing 997 for PO-12345',
      body: 'No functional acknowledgment received within the configured SLA window.',
      dedupeKey: 'missing-ack-PO-12345',
      sourceRef: { poNumber: 'PO-12345' },
      status: 'active',
      createdAt: FIXED_ISO,
      lastSeenAt: FIXED_ISO,
      acknowledgedAt: null,
      acknowledgedBy: null,
      suppressUntil: null,
    },
    {
      id: 'alert-2',
      partnerId: 'partner-sysco',
      type: 'REJECTION_RATE_SPIKE',
      severity: 'critical',
      title: 'SYSCO rejection rate jumped to 22%',
      body: 'Rejection rate over the last hour exceeds the rolling baseline by 18 points.',
      dedupeKey: 'rate-spike-sysco-hourly',
      sourceRef: { partner: 'SYSCO' },
      status: 'active',
      createdAt: FIXED_ISO,
      lastSeenAt: FIXED_ISO,
      acknowledgedAt: null,
      acknowledgedBy: null,
      suppressUntil: null,
    },
  ],
};

interface MockRoute {
  pattern: string;
  body: unknown;
}

const ROUTES: MockRoute[] = [
  { pattern: '**/api/me', body: ME },
  { pattern: '**/api/partners', body: PARTNERS },
  { pattern: '**/api/partners-config*', body: PARTNERS_CONFIG },
  { pattern: '**/api/transactions*', body: TRANSACTIONS },
  { pattern: '**/api/lifecycle*', body: LIFECYCLE },
  { pattern: '**/api/alerts*', body: ALERTS },
];

/** Install all fixture routes onto the page. Call once in `beforeEach`.
 *
 *  Note on route ordering: Playwright matches `page.route` handlers in
 *  LIFO order — the most recently registered handler wins. We register
 *  only the specific patterns; any unmocked /api/* request falls through
 *  to the Vite proxy and surfaces as a visible "could not load" error
 *  on the page, which makes its way into the test failure naturally. */
export async function installApiMocks(page: Page): Promise<void> {
  for (const r of ROUTES) {
    await page.route(r.pattern, async (route) => {
      // Only mock GETs; mutations would never be hit in these tests but
      // we still want POSTs/PATCHes to fall through so a stray mutation
      // doesn't return a silent 200.
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(r.body),
      });
    });
  }
}
