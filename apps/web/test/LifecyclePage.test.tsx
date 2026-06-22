import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { LifecyclePage } from '../src/pages/LifecyclePage.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
function jsonResponse(body: unknown): Promise<FakeResponse> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}
function notFound(): Promise<FakeResponse> {
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: { code: 'NOT_FOUND', message: 'No PO' } }) });
}

const HAPPY_PATH = {
  po: 'PO-100',
  enteredBy: { kind: 'po' as const, value: 'PO-100' },
  flow: 'standard' as const,
  events: [
    {
      kind: 'transaction', transactionSetId: '850', direction: 'inbound', status: 'acknowledged',
      transactionId: 't-850', rawFileId: 'r-850', controlNumber: 'T1',
      ingestedAt: '2026-06-01T10:00:00.000Z', ackStatus: null, ackedByTransactionId: 'ack-850',
    },
    {
      kind: 'transaction', transactionSetId: '997', direction: 'outbound', status: 'received',
      transactionId: 'ack-850', rawFileId: 'r-ack', controlNumber: '9001',
      ingestedAt: '2026-06-01T11:00:00.000Z', ackStatus: 'A', ackedByTransactionId: null,
    },
    {
      kind: 'gap', transactionSetId: '810', direction: 'outbound', status: 'expected_missing',
      transactionId: null, rawFileId: null, controlNumber: null,
      ingestedAt: null, ackStatus: null, ackedByTransactionId: null,
    },
  ],
};

function fakeFetch(input: unknown): Promise<FakeResponse> {
  const url = String(input);
  if (url.includes('/lifecycle?po=PO-100')) return jsonResponse(HAPPY_PATH);
  if (url.includes('/lifecycle?po=PO-NOPE')) return notFound();
  return jsonResponse({});
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/lifecycle/:po" element={<LifecyclePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test('renders every event in chronological order with set badges and a View link per transaction', async () => {
  renderAt('/lifecycle/PO-100');
  // Wait for the first event to land
  const firstSet = await screen.findByText('850');
  // Set badges, in DOM order, should be 850, 997, 810.
  const items = document.querySelectorAll('li');
  expect(items.length).toBe(3);
  expect(items[0]!.textContent).toContain('850');
  expect(items[1]!.textContent).toContain('997');
  expect(items[2]!.textContent).toContain('810');
  // Transaction events have a View link; gap doesn't.
  expect(within(items[0] as HTMLElement).getByRole('link', { name: 'View' })).toBeInTheDocument();
  expect(within(items[1] as HTMLElement).getByRole('link', { name: 'View' })).toBeInTheDocument();
  expect(within(items[2] as HTMLElement).queryByRole('link', { name: 'View' })).toBeNull();
  expect(firstSet).toBeInTheDocument();
});

test('gap row shows the expected-missing copy and dashed kind', async () => {
  renderAt('/lifecycle/PO-100');
  // Wait for events to land
  await screen.findByText('850');
  const gapRow = document.querySelector('li[data-kind="gap"]') as HTMLElement;
  expect(gapRow).not.toBeNull();
  expect(gapRow.textContent).toContain('Expected — not received');
});

test('status and direction labels render in human form', async () => {
  renderAt('/lifecycle/PO-100');
  expect(await screen.findByText('Acknowledged')).toBeInTheDocument();
  expect(screen.getByText('Inbound')).toBeInTheDocument();
  expect(screen.getAllByText('Outbound').length).toBeGreaterThan(0);
});

test('404 from the API renders the empty-state copy', async () => {
  renderAt('/lifecycle/PO-NOPE');
  expect(await screen.findByText(/no po matched/i)).toBeInTheDocument();
});

test('rejected event shows the inline rejection summary line', async () => {
  const REJECTED = {
    po: 'PO-REJ',
    enteredBy: { kind: 'po' as const, value: 'PO-REJ' },
    flow: 'standard' as const,
    events: [
      {
        kind: 'transaction', transactionSetId: '850', direction: 'inbound', status: 'rejected',
        transactionId: 't-rej', rawFileId: 'r-rej', controlNumber: 'T1',
        ingestedAt: '2026-06-01T10:00:00.000Z', ackStatus: null, ackedByTransactionId: 'ack-rej',
        rejectionSummary: 'BEG03 — Mandatory data element missing',
        rejectionDetails: [
          {
            segmentTag: 'BEG', segmentPosition: '2', loopIdentifier: '',
            syntaxErrorCode: '8', syntaxErrorMessage: 'Segment Has Data Element Errors',
            elementErrors: [{ elementPosition: '3', dataElementReference: '324', syntaxErrorCode: '1', syntaxErrorMessage: 'Mandatory data element missing', badValue: '' }],
          },
        ],
      },
    ],
  };
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/lifecycle?po=PO-REJ')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(REJECTED) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  }));
  renderAt('/lifecycle/PO-REJ');
  // Banner with the rejection summary appears.
  expect(await screen.findByTestId('rejection-summary')).toBeInTheDocument();
  expect(screen.getByText(/BEG03 — Mandatory data element missing/)).toBeInTheDocument();
  // The "Full detail" link points to the acked transaction detail page.
  const fullDetail = screen.getByRole('link', { name: /Full detail/ });
  expect(fullDetail).toHaveAttribute('href', '/transactions/t-rej');
});

// ─────────────────────────────────────────────────────────────
// Phase 8 Sprint 3 — partnerChannel "via X" chip on outbound rows
// ─────────────────────────────────────────────────────────────

test('outbound row renders a "via AS2" chip when the partner has connectivity', async () => {
  const WITH_CHANNEL = {
    po: 'PO-CH',
    enteredBy: { kind: 'po' as const, value: 'PO-CH' },
    flow: 'standard' as const,
    events: [
      {
        kind: 'transaction', transactionSetId: '810', direction: 'outbound', status: 'acknowledged',
        transactionId: 't-810', rawFileId: 'r-810', controlNumber: 'T1',
        ingestedAt: '2026-06-01T11:00:00.000Z', ackStatus: null, ackedByTransactionId: null,
        partnerChannel: 'AS2',
      },
      {
        kind: 'transaction', transactionSetId: '850', direction: 'inbound', status: 'received',
        transactionId: 't-850', rawFileId: 'r-850', controlNumber: 'T0',
        ingestedAt: '2026-06-01T10:00:00.000Z', ackStatus: null, ackedByTransactionId: null,
        // Inbound rows never carry partnerChannel — the server filters to outbound.
        partnerChannel: null,
      },
    ],
  };
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/lifecycle?po=PO-CH')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(WITH_CHANNEL) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  }));
  renderAt('/lifecycle/PO-CH');
  // Chip is keyed by testid so it's stable across copy tweaks.
  expect(await screen.findByTestId('partner-channel-AS2')).toBeInTheDocument();
  expect(screen.getByText(/via AS2/)).toBeInTheDocument();
});

test('outbound row renders no channel chip when partnerChannel is null', async () => {
  const WITHOUT_CHANNEL = {
    po: 'PO-NOCX',
    enteredBy: { kind: 'po' as const, value: 'PO-NOCX' },
    flow: 'standard' as const,
    events: [
      {
        kind: 'transaction', transactionSetId: '810', direction: 'outbound', status: 'received',
        transactionId: 't-810x', rawFileId: 'r-810x', controlNumber: 'T1',
        ingestedAt: '2026-06-01T11:00:00.000Z', ackStatus: null, ackedByTransactionId: null,
        partnerChannel: null,
      },
    ],
  };
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/lifecycle?po=PO-NOCX')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(WITHOUT_CHANNEL) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  }));
  renderAt('/lifecycle/PO-NOCX');
  // Wait for content to land before asserting absence.
  await screen.findByText('810');
  expect(screen.queryByTestId('partner-channel-AS2')).toBeNull();
  expect(screen.queryByText(/via /)).toBeNull();
});

