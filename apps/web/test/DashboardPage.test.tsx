import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { DashboardPage } from '../src/pages/DashboardPage.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
function jsonResponse(body: unknown): Promise<FakeResponse> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

const DASHBOARD = {
  trafficSilence: {
    lastGlobalIngestAt: '2026-06-20T11:00:00.000Z',
    isGloballyStale: false,
    staleWindowHours: 6,
    partners: [{ partnerId: 'p-1', displayName: 'Acme', lastIngestAt: '2026-06-20T11:00:00.000Z' }],
  },
  openAlerts: { total: 3, bySeverity: { critical: 1, warning: 2, info: 0 }, topPartners: [] },
  ingestHealth: { window: '24h', parsed: 12, parseError: 1, failed: 0, duplicate: 2, received: 0 },
  rejectionTrends: { windowDays: 7, trends: [{ partner: 'ACME', dailyRates: [0, 0.1, 0.05, 0, 0, 0, 0] }] },
  partnerHealth: [{
    partnerId: 'p-1', displayName: 'Acme',
    lastIngestAt: '2026-06-20T11:00:00.000Z', lastAckAt: null,
    rejectionRate30d: 0.05, openAlertCount: 2, missingAckCount: 1,
  }],
  recentFailures: [{
    id: 'rf-1', status: 'PARSE_ERROR', errorMessage: 'Bad segment',
    ingestedAt: '2026-06-20T10:00:00.000Z', isaControlNumber: '000000001',
  }],
};

function fakeFetch(input: unknown): Promise<FakeResponse> {
  if (String(input).includes('/dashboard')) return jsonResponse(DASHBOARD);
  return jsonResponse({});
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(fakeFetch)); });
afterEach(() => { vi.unstubAllGlobals(); });

test('renders dashboard cards and partner health table', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><DashboardPage /></MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByTestId('open-alerts-total')).toHaveTextContent('3');
  expect(screen.getByTestId('ingest-health')).toHaveTextContent('12 parsed');
  expect(screen.getByText('Acme')).toBeInTheDocument();
  expect(screen.getByTestId('recent-failures')).toBeInTheDocument();
  expect(screen.getByTestId('traffic-by-partner')).toBeInTheDocument();
});
