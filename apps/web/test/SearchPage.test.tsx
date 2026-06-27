import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { SearchPage } from '../src/pages/SearchPage.tsx';

function fakeFetch(input: unknown): Promise<unknown> {
  const url = String(input);
  if (url.includes('/search')) {
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({
        query: 'PO-12345',
        lifecycles: [{
          po: 'PO-12345',
          partnerDisplayName: 'Acme',
          lastActivityAt: '2026-06-17T12:00:00.000Z',
          openAlertCount: 0,
        }],
        transactions: [{ id: 't1', transactionSetId: '850', controlNumber: '0001', poNumber: 'PO-12345', invoiceNumber: null, purpose: '00', senderId: 'ACME', receiverId: 'GLOBEX', status: 'PARSED', ingestedAt: '2026-06-17T12:00:00.000Z', direction: 'inbound' }],
        rawFiles: [{ id: 'r1', s3Key: 'k', fileHash: 'h', isaControlNumber: '000000900', source: 'upload', status: 'PARSED', errorMessage: null, ingestedAt: '2026-06-17T12:00:00.000Z' }],
      }),
    });
  }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
}

function renderSearch(q: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/search?q=${q}`]}>
        <Routes>
          <Route path="/search" element={<SearchPage />} />
          <Route path="/transactions/:id" element={<div>detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn(fakeFetch)));
afterEach(() => vi.unstubAllGlobals());

test('shows matching transactions and raw files for a query', async () => {
  renderSearch('PO-12345');
  // Phase 4 wired a Lifecycle section into SearchPage that also surfaces the
  // PO as a link (to /lifecycle/PO-12345). So there are now TWO links named
  // "PO-12345" and we have to disambiguate by destination.
  const links = await screen.findAllByRole('link', { name: 'PO-12345' });
  const transactionLink = links.find((a) => a.getAttribute('href') === '/transactions/t1');
  const lifecycleLink = links.find((a) => a.getAttribute('href')?.includes('PO-12345'));
  expect(transactionLink).toBeDefined();
  expect(lifecycleLink).toBeDefined();
  expect(screen.getByText('000000900')).toBeInTheDocument(); // raw file by ISA
  expect(screen.getByText(/Transactions \(1\)/)).toBeInTheDocument();
  expect(screen.getByText(/Raw files \(1\)/)).toBeInTheDocument();
  expect(screen.getByText(/Lifecycle conversations \(1\)/)).toBeInTheDocument();
});
