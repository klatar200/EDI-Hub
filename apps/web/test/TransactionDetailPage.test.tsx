import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { TransactionDetailPage } from '../src/pages/TransactionDetailPage.tsx';

const DETAIL = {
  id: 'txn-1', transactionSetId: '850', controlNumber: '0001',
  poNumber: 'PO-12345', invoiceNumber: null, purpose: '00',
  senderId: 'ACME', receiverId: 'GLOBEX', status: 'PARSED', ingestedAt: '2026-06-17T12:00:00.000Z',
  rawFileId: 'raw-1', errorMessage: null, declaredSegmentCount: 4, segmentCount: 4,
  delimiters: { element: '*', subElement: ':', segment: '~' },
  interpreted: {
    type: '850', purpose: '00', poNumber: 'PO-12345', poDate: '20260115',
    lineItems: [{ lineNumber: '1', quantity: '10', unitOfMeasure: 'EA', unitPrice: '25.00', productIdQualifier: 'VP', productId: 'VENDPART1' }],
  },
  rejection: null,
  segments: [
    { tag: 'ST', position: 0, elements: [{ index: 1, value: '850', semanticLabel: 'Transaction Set Identifier Code' }] },
    { tag: 'BEG', position: 1, elements: [
      { index: 1, value: '00', semanticLabel: 'Transaction Set Purpose Code' },
      { index: 3, value: 'PO-12345', semanticLabel: 'Purchase Order Number' },
    ] },
    { tag: 'SE', position: 2, elements: [{ index: 1, value: '4', semanticLabel: 'Number of Included Segments' }] },
  ],
};

const RAW_TEXT = 'ISA*00*...~GS*PO*ACME*GLOBEX*...~ST*850*0001~BEG*00*PO-12345~SE*4*0001~';

function fakeFetch(input: unknown): Promise<unknown> {
  const url = String(input);
  if (url.includes('/raw-files/')) {
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(RAW_TEXT) });
  }
  if (url.includes('/transactions/txn-1')) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DETAIL) });
  }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
}

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/transactions/txn-1']}>
        <Routes>
          <Route path="/transactions/:id" element={<TransactionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn(fakeFetch)));
afterEach(() => vi.unstubAllGlobals());

test('renders the typed header, line items, and labeled segments', async () => {
  renderDetail();
  // header PO number
  expect(await screen.findByText(/Purchase Order Number/)).toBeInTheDocument();
  // line item product
  expect(screen.getByText('VENDPART1')).toBeInTheDocument();
  // segment tags present in the parsed panel
  expect(screen.getAllByText('BEG').length).toBeGreaterThan(0);
});

test('loads raw bytes and cross-highlights a clicked segment', async () => {
  renderDetail();
  // wait for raw panel to load
  const rawLine = await screen.findByText('BEG*00*PO-12345');
  fireEvent.click(rawLine);
  await waitFor(() => {
    // the clicked raw line is highlighted
    expect(rawLine.className).toContain('bg-amber-100');
  });
});

test('renders the structured "Why this was rejected" panel when rejection is present', async () => {
  const REJECTED = {
    ...DETAIL,
    id: 'txn-2',
    rejection: {
      ackTransactionId: 'ack-1',
      ackRawFileId: 'raw-ack-1',
      status: 'R',
      statusMessage: 'Rejected',
      summary: 'BEG03 — Mandatory data element missing',
      details: [
        {
          segmentTag: 'BEG', segmentPosition: '2', loopIdentifier: '',
          syntaxErrorCode: '8', syntaxErrorMessage: 'Segment Has Data Element Errors',
          elementErrors: [
            {
              elementPosition: '3', dataElementReference: '324',
              syntaxErrorCode: '1', syntaxErrorMessage: 'Mandatory data element missing',
              badValue: '',
            },
          ],
        },
      ],
    },
  };
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/raw-files/')) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(RAW_TEXT) });
    }
    if (url.includes('/transactions/txn-2')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(REJECTED) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/transactions/txn-2']}>
        <Routes>
          <Route path="/transactions/:id" element={<TransactionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Panel header + summary + decoded element message all show.
  expect(await screen.findByText(/Why this was rejected/)).toBeInTheDocument();
  expect(screen.getByText('BEG03 — Mandatory data element missing')).toBeInTheDocument();
  expect(screen.getByText('Segment Has Data Element Errors')).toBeInTheDocument();
  // The decoded element-error message appears in the AK4 table.
  expect(screen.getByText('Mandatory data element missing')).toBeInTheDocument();
  // Link to the acking 997 is rendered.
  const ackLink = screen.getByRole('link', { name: /View acknowledgment/ });
  expect(ackLink).toHaveAttribute('href', '/transactions/ack-1');
});

// ─────────────────────────────────────────────────────────────
// Phase 8 Sprint 1 — outbound stage badge + timeline rendering
// ─────────────────────────────────────────────────────────────

test('outbound transaction renders the stage badge + three-step timeline', async () => {
  const OUTBOUND_CONFIRMED = {
    ...DETAIL,
    id: 'txn-out',
    direction: 'outbound' as const,
    generatedAt: '2026-06-17T12:00:00.000Z',
    transmittedAt: '2026-06-17T12:00:00.000Z',
    confirmedAt: '2026-06-17T13:00:00.000Z',
    outboundStage: 'confirmed' as const,
  };
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/raw-files/')) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(RAW_TEXT) });
    }
    if (url.includes('/transactions/txn-out')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(OUTBOUND_CONFIRMED) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/transactions/txn-out']}>
        <Routes>
          <Route path="/transactions/:id" element={<TransactionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Stage chip in the header.
  expect(await screen.findByTestId('stage-badge-confirmed')).toBeInTheDocument();
  // Three-step timeline rendered.
  expect(screen.getByTestId('stage-timeline')).toBeInTheDocument();
  // Every step reached (confirmed = furthest).
  expect(screen.getByTestId('stage-step-generated-reached')).toBeInTheDocument();
  expect(screen.getByTestId('stage-step-transmitted-reached')).toBeInTheDocument();
  expect(screen.getByTestId('stage-step-confirmed-reached')).toBeInTheDocument();
});

test('inbound transaction renders no stage badge and no timeline', async () => {
  const INBOUND = {
    ...DETAIL,
    id: 'txn-in',
    direction: 'inbound' as const,
    generatedAt: null,
    transmittedAt: null,
    confirmedAt: null,
    outboundStage: null,
  };
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/raw-files/')) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(RAW_TEXT) });
    }
    if (url.includes('/transactions/txn-in')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(INBOUND) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/transactions/txn-in']}>
        <Routes>
          <Route path="/transactions/:id" element={<TransactionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Wait for the page to settle (header renders).
  await screen.findByText(/Purchase Order Number/);
  // No stage UI on inbound rows.
  expect(screen.queryByTestId('stage-timeline')).toBeNull();
  expect(screen.queryByTestId('stage-badge-confirmed')).toBeNull();
  expect(screen.queryByTestId('stage-badge-transmitted')).toBeNull();
  expect(screen.queryByTestId('stage-badge-generated')).toBeNull();
});

test('outbound transmitted-but-not-yet-confirmed shows the right partial timeline', async () => {
  const OUTBOUND_TRANS = {
    ...DETAIL,
    id: 'txn-out-t',
    direction: 'outbound' as const,
    generatedAt: '2026-06-17T12:00:00.000Z',
    transmittedAt: '2026-06-17T12:00:00.000Z',
    confirmedAt: null,
    outboundStage: 'transmitted' as const,
  };
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/raw-files/')) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(RAW_TEXT) });
    }
    if (url.includes('/transactions/txn-out-t')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(OUTBOUND_TRANS) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/transactions/txn-out-t']}>
        <Routes>
          <Route path="/transactions/:id" element={<TransactionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByTestId('stage-badge-transmitted')).toBeInTheDocument();
  // Generated + Transmitted reached; Confirmed pending.
  expect(screen.getByTestId('stage-step-generated-reached')).toBeInTheDocument();
  expect(screen.getByTestId('stage-step-transmitted-reached')).toBeInTheDocument();
  expect(screen.getByTestId('stage-step-confirmed')).toBeInTheDocument();
});

