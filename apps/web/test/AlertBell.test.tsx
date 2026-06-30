import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { AlertBell } from '../src/components/AlertBell.tsx';
import { MeProvider } from '../src/lib/useRole.tsx';
import { ToastProvider } from '../src/lib/useToast.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
function json(body: unknown): Promise<FakeResponse> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

const SAMPLE = {
  items: [
    {
      id: 'a-1', partnerId: 'p-1', type: 'MISSING_ACK', severity: 'warning',
      title: 'Sysco: 810 outbound missing 997 ack', body: 'overdue by 65 minutes',
      dedupeKey: 'k1', sourceRef: { poNumber: 'PO-12345' },
      status: 'active',
      createdAt: '2026-06-18T10:00:00.000Z', lastSeenAt: '2026-06-18T10:00:00.000Z',
      acknowledgedAt: null, acknowledgedBy: null, suppressUntil: null,
    },
  ],
};

function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <MeProvider orgId="test-org">
            <AlertBell />
          </MeProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  let acked = false;
  vi.stubGlobal('fetch', vi.fn((input: unknown, init?: { method?: string }) => {
    const url = String(input);
    if (url.includes('/me')) {
      return json({
        id: 'u-1', email: 'ops@test.local', displayName: 'Ops',
        role: 'admin', clerkUserId: 'user_test',
      });
    }
    if (url.includes('/alerts/a-1/ack') && init?.method === 'PATCH') {
      acked = true;
      return json({ ...SAMPLE.items[0], status: 'acknowledged' });
    }
    if (url.includes('/alerts')) {
      if (acked) return json({ items: [] });
      return json(SAMPLE);
    }
    return json({});
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test('shows unread badge and peek list', async () => {
  renderBell();
  expect(await screen.findByTestId('alert-bell-badge')).toHaveTextContent('1');
  fireEvent.click(screen.getByTestId('alert-bell-trigger'));
  const peek = await screen.findByTestId('alert-bell-peek');
  expect(peek.textContent).toContain('Sysco: 810 outbound missing 997 ack');
  expect(screen.getByTestId('alert-bell-view-all')).toHaveAttribute('href', '/alerts');
});

test('ack from peek clears badge after refetch', async () => {
  renderBell();
  await screen.findByTestId('alert-bell-badge');
  fireEvent.click(screen.getByTestId('alert-bell-trigger'));
  fireEvent.click(await screen.findByTestId('alert-bell-ack-a-1'));
  await waitFor(() => {
    expect(screen.queryByTestId('alert-bell-badge')).toBeNull();
  });
});
