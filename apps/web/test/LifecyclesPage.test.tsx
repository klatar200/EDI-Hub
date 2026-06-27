import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { LifecyclesPage } from '../src/pages/LifecyclesPage.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
function jsonResponse(body: unknown): Promise<FakeResponse> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

const LIST_ROW = {
  po: 'PO-100',
  partnerId: 'p-1',
  partnerDisplayName: 'Acme Foods',
  flow: 'standard' as const,
  startedAt: '2026-06-01T10:00:00.000Z',
  lastActivityAt: '2026-06-05T11:00:00.000Z',
  received: 4,
  missing: 1,
  rejected: 0,
  openAlertCount: 2,
  hasParseError: true,
  hasDuplicates: false,
  additionalDocumentCount: 0,
  expectedWarnings: ['856 (outbound) expected — not yet received'],
};

const TIMELINE = {
  po: 'PO-100',
  enteredBy: { kind: 'po' as const, value: 'PO-100' },
  flow: 'standard' as const,
  partner: { id: 'p-1', displayName: 'Acme Foods' },
  events: [
    {
      kind: 'transaction', transactionSetId: '850', direction: 'inbound', status: 'received',
      transactionId: 't-850', rawFileId: 'r-850', controlNumber: 'T1',
      ingestedAt: '2026-06-01T10:00:00.000Z', ackStatus: null, ackedByTransactionId: null,
      rejectionSummary: null, rejectionDetails: null, outboundStage: null, partnerChannel: null,
      isaControlNumber: null, source: null, instanceIndex: null,
    },
    {
      kind: 'gap', transactionSetId: '856', direction: 'outbound', status: 'expected_missing',
      transactionId: null, rawFileId: null, controlNumber: null,
      ingestedAt: null, ackStatus: null, ackedByTransactionId: null,
      rejectionSummary: null, rejectionDetails: null, outboundStage: null, partnerChannel: null,
      isaControlNumber: null, source: null, instanceIndex: null,
    },
  ],
};

function fakeFetch(input: unknown): Promise<FakeResponse> {
  const url = String(input);
  if (url.includes('/lifecycles/') && url.includes('/notes')) {
    return jsonResponse({ items: [] });
  }
  if (url.includes('/lifecycles')) {
    return jsonResponse({ items: [LIST_ROW], page: 1, pageSize: 25, total: 1 });
  }
  if (url.includes('/lifecycle?po=PO-100')) return jsonResponse(TIMELINE);
  if (url.includes('/settings')) {
    return jsonResponse({ settings: { slaCountdownEnabled: false, staleTrafficWindowHours: 6 }, canEdit: false });
  }
  if (url.includes('/partners-config')) return jsonResponse({ items: [] });
  return jsonResponse({});
}

function renderPage(initialPath = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LifecyclesPage />
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

test('renders lifecycle rows with partner and alert badge', async () => {
  renderPage();
  const row = await screen.findByTestId('lifecycle-row-PO-100');
  expect(within(row).getByText('Acme Foods')).toBeInTheDocument();
  expect(within(row).getByText('Standard')).toBeInTheDocument();
  expect(screen.getByTestId('alert-badge-PO-100')).toBeInTheDocument();
});

test('shows parse-error badge linking to ingestions', async () => {
  renderPage();
  const badge = await screen.findByTestId('parse-error-badge-PO-100');
  expect(badge).toHaveAttribute('href', '/ingestions?status=PARSE_ERROR');
});

test('expand loads timeline without route change', async () => {
  renderPage();
  const row = await screen.findByTestId('lifecycle-row-PO-100');
  const expandBtn = within(row).getByRole('button', { name: 'Expand' });
  fireEvent.click(expandBtn);
  const panel = await screen.findByTestId('expand-panel-PO-100');
  expect(panel.textContent).toContain('850');
  expect(panel.textContent).toContain('Expected — not received');
  expect(within(panel).getByTestId('download-raw')).toBeInTheDocument();
  expect(within(panel).getByTestId('lifecycle-export-menu')).toBeInTheDocument();
});

test('shows expected-doc warning badge on list row', async () => {
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/lifecycles')) {
      return jsonResponse({
        items: [{ ...LIST_ROW, hasParseError: false }],
        page: 1,
        pageSize: 25,
        total: 1,
      });
    }
    return fakeFetch(input);
  }));
  renderPage();
  await screen.findByTestId('expected-warning-PO-100');
});

test('filters refetch with URL-reflected hasAlerts param', async () => {
  const fetchMock = vi.fn(fakeFetch);
  vi.stubGlobal('fetch', fetchMock);
  renderPage('/?hasAlerts=true');
  await screen.findByTestId('lifecycle-row-PO-100');
  await waitFor(() => {
    const lifecyclesCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/lifecycles'));
    expect(lifecyclesCall).toBeDefined();
    expect(String(lifecyclesCall![0])).toMatch(/hasAlerts=true/);
  });
});

test('changing parse-error filter updates fetch query', async () => {
  const fetchMock = vi.fn(fakeFetch);
  vi.stubGlobal('fetch', fetchMock);
  renderPage();
  await screen.findByTestId('lifecycle-row-PO-100');
  const parseSelect = screen.getAllByRole('combobox').at(-1)!;
  fireEvent.change(parseSelect, { target: { value: 'true' } });
  await waitFor(() => {
    const calls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/lifecycles'));
    expect(calls.some((c) => String(c[0]).includes('hasParseError=true'))).toBe(true);
  });
});
