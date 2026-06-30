import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { DocumentsPage } from '../src/pages/DocumentsPage.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
function jsonResponse(body: unknown): Promise<FakeResponse> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

// One fixture, two URLs — the page asks /transactions for parsed and /ingest
// (the existing IngestionsPage endpoint) for raw. The fixture has to answer
// both so the embedded page renders without a loading spinner sticking.
function fakeFetch(input: unknown): Promise<FakeResponse> {
  const url = String(input);
  if (url.includes('/partners-config')) return jsonResponse({ items: [] });
  if (url.includes('/partners')) return jsonResponse({ partners: ['ACME'] });
  if (url.includes('/transactions')) {
    return jsonResponse({
      items: [
        {
          id: 't1', transactionSetId: '850', controlNumber: '0001',
          poNumber: 'PO-12345', invoiceNumber: null, purpose: '00',
          senderId: 'ACME', receiverId: 'GLOBEX', status: 'PARSED',
          ingestedAt: '2026-06-17T12:00:00.000Z', direction: 'inbound',
        },
      ],
      limit: 25, offset: 0, count: 1,
    });
  }
  if (url.includes('/ingest')) {
    return jsonResponse({
      items: [
        {
          id: 'r1',
          isaControlNumber: '000000001',
          source: 'sftp',
          status: 'PARSED',
          receivedAt: '2026-06-17T12:00:00.000Z',
          partnerId: null,
          partnerName: null,
        },
      ],
    });
  }
  return jsonResponse({});
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/documents" element={
            <>
              <DocumentsPage />
              <LocationSpy />
            </>
          } />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Mirrors `useLocation()` into a hidden DOM node so tests can read the
 *  current search string without diving into the router internals. */
function LocationSpy(): JSX.Element {
  const { search } = useLocation();
  return <div data-testid="location-search">{search}</div>;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test('defaults to the parsed transactions view', async () => {
  renderAt('/documents');
  // The page title is "Documents" and the parsed table renders the
  // fixture row's PO number.
  expect(await screen.findByText('Documents')).toBeInTheDocument();
  expect(await screen.findByText('PO-12345')).toBeInTheDocument();
});

test('?view=raw renders the raw ingestions list instead', async () => {
  renderAt('/documents?view=raw');
  // The ISA control number column is unique to the raw view.
  expect(await screen.findByText('000000001')).toBeInTheDocument();
});

test('switching the toggle updates the URL and the rendered list', async () => {
  renderAt('/documents');
  await screen.findByText('PO-12345');
  fireEvent.click(screen.getByTestId('documents-view-raw'));
  await waitFor(() => {
    expect(screen.getByTestId('location-search')).toHaveTextContent('view=raw');
  });
  // After the toggle, the raw list's ISA column should be present and the
  // parsed list's PO column should no longer be rendered.
  expect(await screen.findByText('000000001')).toBeInTheDocument();
  expect(screen.queryByText('PO-12345')).not.toBeInTheDocument();
});
