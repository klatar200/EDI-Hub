import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { AlertsPage } from '../src/pages/AlertsPage.tsx';

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
    return json({});
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AlertsPage />
      </MemoryRouter>
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

