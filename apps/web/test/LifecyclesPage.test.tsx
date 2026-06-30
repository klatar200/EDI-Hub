import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { LifecyclesPage } from '../src/pages/LifecyclesPage.tsx';
import { MeProvider } from '../src/lib/useRole.tsx';

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
  slaSummary: null,
  dueDate: null,
};

const TIMELINE = {
  po: 'PO-100',
  enteredBy: { kind: 'po' as const, value: 'PO-100' },
  flow: 'standard' as const,
  partner: { id: 'p-1', displayName: 'Acme Foods', slaCountdownEnabled: false, slaWindows: [] },
  dueDate: null,
  linkedPos: [],
  events: [
    {
      kind: 'transaction', transactionSetId: '850', direction: 'inbound', status: 'received',
      transactionId: 't-850', rawFileId: 'r-850', controlNumber: 'T1',
      ingestedAt: '2026-06-01T10:00:00.000Z', ackStatus: null, ackedByTransactionId: null,
      rejectionSummary: null, rejectionDetails: null, outboundStage: null, partnerChannel: null,
      isaControlNumber: null, source: null, instanceIndex: null, headerSummary: null,
    },
    {
      kind: 'gap', transactionSetId: '856', direction: 'outbound', status: 'expected_missing',
      transactionId: null, rawFileId: null, controlNumber: null,
      ingestedAt: null, ackStatus: null, ackedByTransactionId: null,
      rejectionSummary: null, rejectionDetails: null, outboundStage: null, partnerChannel: null,
      isaControlNumber: null, source: null, instanceIndex: null, headerSummary: null,
    },
  ],
};

function fakeFetch(input: unknown): Promise<FakeResponse> {
  const url = String(input);
  if (url.includes('/me')) {
    return jsonResponse({
      id: 'u-1',
      email: 'ops@test.local',
      displayName: 'Ops',
      role: 'admin',
      clerkUserId: 'user_test',
    });
  }
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
  if (url.includes('/preferences')) {
    return jsonResponse({ preferences: { savedViews: [], pinnedPos: [] } });
  }
  return jsonResponse({});
}

let preferencesState = { savedViews: [] as Array<{ id: string; name: string; query: string }>, pinnedPos: [] as string[] };

function fakeFetchWithPrefs(input: unknown, init?: RequestInit): Promise<FakeResponse> {
  const url = String(input);
  if (url.includes('/preferences') && init?.method === 'PATCH') {
    preferencesState = JSON.parse(String(init.body)) as typeof preferencesState;
    return jsonResponse({ preferences: preferencesState });
  }
  if (url.includes('/preferences')) {
    return jsonResponse({ preferences: preferencesState });
  }
  return fakeFetch(input);
}

function renderPage(initialPath = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <MeProvider orgId="test-org">
          <LifecyclesPage />
        </MeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  preferencesState = { savedViews: [], pinnedPos: [] };
  vi.stubGlobal('fetch', vi.fn(fakeFetchWithPrefs));
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

test('Needs attention tab reflects in the lifecycles query', async () => {
  const fetchMock = vi.fn(fakeFetch);
  vi.stubGlobal('fetch', fetchMock);
  renderPage();
  await screen.findByTestId('lifecycle-row-PO-100');
  fireEvent.click(screen.getByTestId('lifecycle-view-needs-attention'));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('needsAttention=true'));
    expect(call).toBeDefined();
  });
});

test('changing parse-error filter updates fetch query', async () => {
  const fetchMock = vi.fn(fakeFetchWithPrefs);
  vi.stubGlobal('fetch', fetchMock);
  renderPage();
  await screen.findByTestId('lifecycle-row-PO-100');
  // T1 — narrow-the-list filters now live inside a Filters popover so the
  // bar isn't ten controls wide. Open the popover before reaching for the
  // Parse errors select.
  fireEvent.click(screen.getByTestId('filters-popover-trigger'));
  const parseSelect = await waitFor(() => {
    const match = screen.getAllByRole('combobox').find((el) =>
      Array.from(el.querySelectorAll('option')).some((o) => o.textContent === 'Parse errors only'),
    );
    if (!match) throw new Error('Parse errors select not in DOM yet');
    return match;
  });
  fireEvent.change(parseSelect, { target: { value: 'true' } });
  await waitFor(() => {
    const calls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/lifecycles'));
    expect(calls.some((c) => String(c[0]).includes('hasParseError=true'))).toBe(true);
  });
});

test('pin button updates preferences', async () => {
  renderPage();
  await screen.findByTestId('lifecycle-row-PO-100');
  fireEvent.click(screen.getByTestId('pin-PO-100'));
  await waitFor(() => {
    expect(preferencesState.pinnedPos).toContain('PO-100');
  });
});

test('pinned only filter requests pos query param', async () => {
  preferencesState.pinnedPos = ['PO-100'];
  const fetchMock = vi.fn(fakeFetchWithPrefs);
  vi.stubGlobal('fetch', fetchMock);
  renderPage('/?pinnedOnly=true');
  await screen.findByTestId('lifecycle-row-PO-100');
  await waitFor(() => {
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/lifecycles') && String(c[0]).includes('pos=PO-100'));
    expect(call).toBeDefined();
  });
});

test('save view persists current filters', async () => {
  renderPage('/?hasAlerts=true');
  await screen.findByTestId('lifecycle-row-PO-100');
  fireEvent.change(screen.getByTestId('save-view-name'), { target: { value: 'Open alerts' } });
  fireEvent.click(screen.getByTestId('save-view-btn'));
  await waitFor(() => {
    expect(preferencesState.savedViews.some((v) => v.name === 'Open alerts' && v.query.includes('hasAlerts=true'))).toBe(true);
  });
});

test('load saved view refetches with stored query', async () => {
  preferencesState.savedViews = [{ id: 'v1', name: 'Alerts', query: 'hasAlerts=true' }];
  const fetchMock = vi.fn(fakeFetchWithPrefs);
  vi.stubGlobal('fetch', fetchMock);
  renderPage();
  await screen.findByTestId('saved-view-select');
  fireEvent.change(screen.getByTestId('saved-view-select'), { target: { value: 'v1' } });
  await waitFor(() => {
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/lifecycles') && String(c[0]).includes('hasAlerts=true'));
    expect(call).toBeDefined();
  });
});
