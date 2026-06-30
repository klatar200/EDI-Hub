import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { TransactionsPage } from '../src/pages/TransactionsPage.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
function jsonResponse(body: unknown): Promise<FakeResponse> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

function fakeFetch(input: unknown): Promise<FakeResponse> {
  const url = String(input);
  if (url.includes('/partners')) return jsonResponse({ partners: ['ACME', 'GLOBEX'] });
  if (url.includes('/preferences')) return jsonResponse({ preferences: {} });
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
  return jsonResponse({});
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TransactionsPage />
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

test('renders transactions returned by the API', async () => {
  renderPage();
  const cell = await screen.findByText('PO-12345');
  const row = cell.closest('tr');
  expect(row).not.toBeNull();
  // 'PARSED'/'ACME' also appear in filter dropdowns, so scope to the row.
  expect(within(row as HTMLElement).getByText('PARSED')).toBeInTheDocument();
  expect(within(row as HTMLElement).getByText('ACME')).toBeInTheDocument();
});

test('populates the partner filter from /partners', async () => {
  renderPage();
  await waitFor(() => expect(screen.getByRole('option', { name: 'GLOBEX' })).toBeInTheDocument());
});

test('table display menu toggles column visibility', async () => {
  let prefs = { tablePrefs: { transactions: { hiddenColumns: [] as string[] } } };
  vi.stubGlobal('fetch', vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/preferences') && init?.method === 'PATCH') {
      prefs = JSON.parse(String(init.body)) as typeof prefs;
      return jsonResponse({ preferences: prefs });
    }
    if (url.includes('/preferences')) return jsonResponse({ preferences: prefs });
    return fakeFetch(input);
  }));
  renderPage();
  await screen.findByText('PO-12345');
  fireEvent.click(screen.getByTestId('table-columns-trigger'));
  const senderToggle = await screen.findByTestId('table-column-toggle-sender');
  fireEvent.click(senderToggle);
  await waitFor(() => {
    expect(prefs.tablePrefs?.transactions?.hiddenColumns).toContain('sender');
  });
});
