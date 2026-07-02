import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { MetricsPage } from '../src/pages/MetricsPage.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
function jsonResponse(body: unknown): Promise<FakeResponse> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

const SAMPLE = {
  windowFrom: '2026-05-19T00:00:00.000Z',
  windowTo: '2026-06-18T00:00:00.000Z',
  rows: [
    { partner: 'ACME', total: 10, rejected: 4, rate: 0.4 },
    { partner: 'GLOBEX', total: 50, rejected: 1, rate: 0.02 },
    { partner: 'CLEAN', total: 12, rejected: 0, rate: 0 },
  ],
};

function fakeFetch(input: unknown): Promise<FakeResponse> {
  const url = String(input);
  if (url.includes('/metrics/rejection-rate')) return jsonResponse(SAMPLE);
  return jsonResponse({});
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MetricsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn(fakeFetch)));
afterEach(() => vi.unstubAllGlobals());

test('renders a row per partner with the formatted rate', async () => {
  renderPage();
  expect(await screen.findByText('ACME')).toBeInTheDocument();
  expect(screen.getByText('GLOBEX')).toBeInTheDocument();
  expect(screen.getByText('CLEAN')).toBeInTheDocument();
  // Rate is shown as percentage with one decimal.
  expect(screen.getByText('40.0%')).toBeInTheDocument();
  expect(screen.getByText('2.0%')).toBeInTheDocument();
  expect(screen.getByText('0.0%')).toBeInTheDocument();
});

test('shows the rolling-window helper text and total partner count', async () => {
  renderPage();
  await screen.findByText('ACME');
  expect(screen.getByText(/3 partner\(s\)/)).toBeInTheDocument();
  expect(screen.getByText(/strict X12 definition/)).toBeInTheDocument();
});

test('empty rows fall back to the empty state', async () => {
  vi.stubGlobal('fetch', vi.fn((_: unknown) =>
    jsonResponse({ windowFrom: '2026-05-19T00:00:00.000Z', windowTo: '2026-06-18T00:00:00.000Z', rows: [] }),
  ));
  renderPage();
  expect(await screen.findByText(/No 997s received in this window/)).toBeInTheDocument();
});
