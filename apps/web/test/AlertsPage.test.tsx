import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { AlertsPage } from '../src/pages/AlertsPage.tsx';
import { MeProvider } from '../src/lib/useRole.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
function json(body: unknown): Promise<FakeResponse> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

const SAMPLE = {
  items: [
    {
      id: 'a-1', partnerId: 'p-1', type: 'MISSING_ACK', severity: 'warning',
      title: 'Sysco: 810 outbound missing 997 ack', body: 'overdue by 65 minutes',
      dedupeKey: 'k1', sourceRef: { poNumber: 'PO-12345', withinMinutes: 60, overdueMinutes: 65, previewTrail: [{ channel: 'email', recipient: 'ops@sysco.com', at: '2026-06-18T10:00:00Z' }] },
      status: 'active',
      createdAt: '2026-06-18T10:00:00.000Z', lastSeenAt: '2026-06-18T10:00:00.000Z',
      acknowledgedAt: null, acknowledgedBy: null, suppressUntil: null,
    },
  ],
};

beforeEach(() => {
  // Mutable so the post-ack refetch reflects the new state.
  let acked = false;
  vi.stubGlobal('fetch', vi.fn((input: unknown, init?: { method?: string }) => {
    const url = String(input);
    if (url.includes('/alerts/a-1/ack') && init?.method === 'PATCH') {
      acked = true;
      return json({
        ...SAMPLE.items[0], status: 'acknowledged',
        acknowledgedAt: '2026-06-18T10:05:00.000Z', acknowledgedBy: 'ops',
      });
    }
    if (url.includes('/alerts')) {
      if (acked) {
        // After ack, the active-status filter returns no rows; an unfiltered
        // refetch returns the row with status flipped.
        const queryUrl = new URL(url, 'http://x');
        const wantsActive = queryUrl.searchParams.get('status') === 'active';
        if (wantsActive) return json({ items: [] });
        return json({
          items: [{
            ...SAMPLE.items[0], status: 'acknowledged',
            acknowledgedAt: '2026-06-18T10:05:00.000Z', acknowledgedBy: 'ops',
          }],
        });
      }
      return json(SAMPLE);
    }
    if (url.includes('/me')) return json({ id: 'u-1', role: 'ops', displayName: 'Ops', email: 'ops@test' });
    if (url.includes('/ops/detect') && init?.method === 'POST') return json({ ok: true });
    if (url.includes('/alerts/bulk-ack') && init?.method === 'POST') {
      acked = true;
      return json({ acknowledged: 1 });
    }
    return json({});
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MeProvider>
        <MemoryRouter>
          <AlertsPage />
        </MemoryRouter>
      </MeProvider>
    </QueryClientProvider>,
  );
}

test('renders structured partner, type label, and age vs SLA metadata', async () => {
  renderPage();
  await screen.findByText(/Sysco: 810 outbound missing 997 ack/);
  expect(screen.getByTestId('alert-partner').textContent).toBe('Sysco');
  expect(screen.getByTestId('alert-type-label').textContent).toBe('Missing 997 ack');
  expect(screen.getByTestId('alert-age-sla').textContent).toContain('65m elapsed');
  expect(screen.getByTestId('alert-age-sla').textContent).toContain('SLA 60m');
});

test('renders alerts with severity + title + body', async () => {
  renderPage();
  expect(await screen.findByText(/Sysco: 810 outbound missing 997 ack/)).toBeInTheDocument();
  expect(screen.getByText(/overdue by 65 minutes/)).toBeInTheDocument();
  expect(screen.getByText('warning')).toBeInTheDocument();
});

test('shows preview-mode trail when sourceRef.previewTrail is populated', async () => {
  renderPage();
  await screen.findByText(/Sysco: 810 outbound missing 997 ack/);
  const trail = screen.getByTestId('preview-trail');
  expect(trail.textContent).toContain('email:ops@sysco.com');
});

test('clicking Acknowledge posts and the row updates', async () => {
  renderPage();
  const button = await screen.findByText('Acknowledge');
  fireEvent.click(button);
  await waitFor(() => {
    expect(screen.queryByText('Acknowledge')).toBeNull();
  });
});

test('lifecycle link appears when sourceRef has poNumber', async () => {
  renderPage();
  const link = await screen.findByTestId('lifecycle-link');
  expect(link.getAttribute('href')).toBe('/lifecycle/PO-12345');
});

test('snooze select is rendered for active alerts', async () => {
  renderPage();
  expect(await screen.findByTestId('snooze-select')).toBeInTheDocument();
});

test('partner filter refetches alerts with partnerName query', async () => {
  const fetchMock = vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/me')) return json({ id: 'u-1', role: 'ops', displayName: 'Ops', email: 'ops@test' });
    if (url.includes('/alerts')) return json(SAMPLE);
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  renderPage();
  await screen.findByText(/Sysco: 810 outbound missing 997 ack/);
  fireEvent.change(screen.getByTestId('partner-filter'), { target: { value: 'Sysco' } });
  await waitFor(() => {
    const alertCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/alerts') && String(c[0]).includes('partnerName=Sysco'));
    expect(alertCall).toBeDefined();
  });
});

test('run detection posts to ops/detect', async () => {
  renderPage();
  await screen.findByText(/Sysco: 810 outbound missing 997 ack/);
  fireEvent.click(await screen.findByTestId('run-detection'));
  await waitFor(() => {
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/ops/detect'), expect.objectContaining({ method: 'POST' }));
  });
});

test('bulk ack posts to alerts/bulk-ack', async () => {
  renderPage();
  fireEvent.click(await screen.findByTestId('bulk-ack'));
  await waitFor(() => {
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/alerts/bulk-ack'), expect.objectContaining({ method: 'POST' }));
  });
});
