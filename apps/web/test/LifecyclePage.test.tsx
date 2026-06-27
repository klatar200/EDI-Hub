import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
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

const EVENT_DEFAULTS = {
  rejectionSummary: null,
  rejectionDetails: null,
  outboundStage: null,
  partnerChannel: null,
  isaControlNumber: null,
  source: null,
  instanceIndex: null,
  headerSummary: null,
} as const;

const HAPPY_PATH = {
  po: 'PO-100',
  enteredBy: { kind: 'po' as const, value: 'PO-100' },
  flow: 'standard' as const,
  dueDate: null,
  linkedPos: [],
  events: [
    {
      ...EVENT_DEFAULTS,
      kind: 'transaction', transactionSetId: '850', direction: 'inbound', status: 'acknowledged',
      transactionId: 't-850', rawFileId: 'r-850', controlNumber: 'T1',
      ingestedAt: '2026-06-01T10:00:00.000Z', ackStatus: null, ackedByTransactionId: 'ack-850',
      isaControlNumber: '000000001', source: 'sftp', instanceIndex: null,
    },
    {
      ...EVENT_DEFAULTS,
      kind: 'transaction', transactionSetId: '997', direction: 'outbound', status: 'received',
      transactionId: 'ack-850', rawFileId: 'r-ack', controlNumber: '9001',
      ingestedAt: '2026-06-01T11:00:00.000Z', ackStatus: 'A', ackedByTransactionId: null,
      isaControlNumber: '000000002', source: 'upload', instanceIndex: null,
    },
    {
      ...EVENT_DEFAULTS,
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

test('renders every event in chronological order with set badges and detail links per transaction', async () => {
  renderAt('/lifecycle/PO-100');
  const firstSet = await screen.findByText('850');
  const items = document.querySelectorAll('li');
  expect(items.length).toBe(3);
  expect(items[0]!.textContent).toContain('850');
  expect(items[1]!.textContent).toContain('997');
  expect(items[2]!.textContent).toContain('810');
  expect(within(items[0] as HTMLElement).getByRole('link', { name: 'Full detail' })).toBeInTheDocument();
  expect(within(items[1] as HTMLElement).getByRole('link', { name: 'Full detail' })).toBeInTheDocument();
  expect(within(items[2] as HTMLElement).queryByRole('link', { name: 'Full detail' })).toBeNull();
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
    dueDate: null,
    linkedPos: [],
    events: [
      {
        ...EVENT_DEFAULTS,
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
  const fullDetailLinks = screen.getAllByRole('link', { name: /Full detail/ });
  expect(fullDetailLinks.some((l) => l.getAttribute('href') === '/transactions/t-rej')).toBe(true);
});

// ─────────────────────────────────────────────────────────────
// Phase 8 Sprint 3 — partnerChannel "via X" chip on outbound rows
// ─────────────────────────────────────────────────────────────

test('outbound row renders a "via AS2" chip when the partner has connectivity', async () => {
  const WITH_CHANNEL = {
    po: 'PO-CH',
    enteredBy: { kind: 'po' as const, value: 'PO-CH' },
    flow: 'standard' as const,
    dueDate: null,
    linkedPos: [],
    events: [
      {
        ...EVENT_DEFAULTS,
        kind: 'transaction', transactionSetId: '810', direction: 'outbound', status: 'acknowledged',
        transactionId: 't-810', rawFileId: 'r-810', controlNumber: 'T1',
        ingestedAt: '2026-06-01T11:00:00.000Z', ackStatus: null, ackedByTransactionId: null,
        partnerChannel: 'AS2',
      },
      {
        ...EVENT_DEFAULTS,
        kind: 'transaction', transactionSetId: '850', direction: 'inbound', status: 'received',
        transactionId: 't-850', rawFileId: 'r-850', controlNumber: 'T0',
        ingestedAt: '2026-06-01T10:00:00.000Z', ackStatus: null, ackedByTransactionId: null,
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
    dueDate: null,
    linkedPos: [],
    events: [
      {
        ...EVENT_DEFAULTS,
        kind: 'transaction', transactionSetId: '810', direction: 'outbound', status: 'received',
        transactionId: 't-810x', rawFileId: 'r-810x', controlNumber: 'T1',
        ingestedAt: '2026-06-01T11:00:00.000Z', ackStatus: null, ackedByTransactionId: null,
        outboundStage: 'transmitted' as const,
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
  await screen.findByText('810');
  expect(screen.getByText('Transmitted')).toBeInTheDocument();
  expect(screen.getByText('Not Confirmed')).toBeInTheDocument();
  expect(screen.queryByText('Received')).toBeNull();
  expect(screen.queryByTestId('partner-channel-AS2')).toBeNull();
  expect(screen.queryByText(/via /)).toBeNull();
});

test('duplicate badge renders when two events share set and direction', async () => {
  const DUPLICATES = {
    po: 'PO-DUP',
    enteredBy: { kind: 'po' as const, value: 'PO-DUP' },
    flow: 'standard' as const,
    dueDate: null,
    linkedPos: [],
    events: [
      {
        ...EVENT_DEFAULTS,
        kind: 'transaction', transactionSetId: '850', direction: 'inbound', status: 'received',
        transactionId: 't-850a', rawFileId: 'r-a', controlNumber: 'T1',
        ingestedAt: '2026-06-01T10:00:00.000Z', ackStatus: null, ackedByTransactionId: null,
        isaControlNumber: '000000101', source: 'upload', instanceIndex: 1,
      },
      {
        ...EVENT_DEFAULTS,
        kind: 'transaction', transactionSetId: '850', direction: 'inbound', status: 'received',
        transactionId: 't-850b', rawFileId: 'r-b', controlNumber: 'T2',
        ingestedAt: '2026-06-01T10:05:00.000Z', ackStatus: null, ackedByTransactionId: null,
        isaControlNumber: '000000102', source: 'sftp', instanceIndex: 2,
      },
    ],
  };
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/lifecycle?po=PO-DUP')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DUPLICATES) });
    }
    if (url.includes('/raw-files/r-a/content')) {
      return { ok: true, status: 200, text: () => Promise.resolve('ISA*00*COPY-A~ST*850*0001~') };
    }
    if (url.includes('/raw-files/r-b/content')) {
      return { ok: true, status: 200, text: () => Promise.resolve('ISA*00*COPY-B~ST*850*0002~') };
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  }));
  renderAt('/lifecycle/PO-DUP');
  const badges = await screen.findAllByTestId('duplicate-badge');
  expect(badges.length).toBe(2);
  expect(badges[0]!.textContent).toContain('1 of 2');
  expect(badges[1]!.textContent).toContain('2 of 2');
  expect(await screen.findByTestId('duplicate-compare-section')).toBeInTheDocument();
  expect(await screen.findByTestId('duplicate-compare-850-inbound')).toBeInTheDocument();
  expect(await screen.findByText(/ISA\*00\*COPY-A/)).toBeInTheDocument();
  expect(await screen.findByText(/ISA\*00\*COPY-B/)).toBeInTheDocument();
});

test('expand raw loads raw file content inline', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/lifecycle?po=PO-100')) {
      return { ok: true, status: 200, json: () => Promise.resolve(HAPPY_PATH) };
    }
    if (url.includes('/raw-files/r-850/content')) {
      return { ok: true, status: 200, text: () => Promise.resolve('ISA*00*TEST~ST*850*0001~') };
    }
    return { ok: true, status: 200, json: () => Promise.resolve({}) };
  }));
  renderAt('/lifecycle/PO-100');
  await screen.findByText('850');
  const expandButtons = await screen.findAllByRole('button', { name: 'Expand raw' });
  expandButtons[0]!.click();
  expect(await screen.findByTestId('lifecycle-raw-panel')).toBeInTheDocument();
  expect(screen.getByText(/ISA\*00\*TEST/)).toBeInTheDocument();
});

test('lifecycle export menu triggers download', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/lifecycle?po=PO-100')) {
      return { ok: true, status: 200, json: () => Promise.resolve(HAPPY_PATH) };
    }
    if (url.includes('/lifecycles/PO-100/export?format=txt')) {
      return { ok: true, status: 200, blob: () => Promise.resolve(new Blob(['lifecycle txt'])) };
    }
    return { ok: true, status: 200, json: () => Promise.resolve({}) };
  }));
  renderAt('/lifecycle/PO-100');
  await screen.findByText('850');
  fireEvent.click(await screen.findByTestId('export-lifecycle-txt'));
  await waitFor(() => {
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/lifecycles/PO-100/export?format=txt'), expect.anything());
  });
});

