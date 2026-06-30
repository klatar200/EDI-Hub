import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { SetupProgressIndicator } from '../src/components/SetupProgressIndicator.tsx';
import { MeProvider } from '../src/lib/useRole.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
function json(body: unknown): Promise<FakeResponse> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

function renderIndicator() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MeProvider orgId="test-org">
          <SetupProgressIndicator />
        </MeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/me')) {
      return json({ id: 'u-1', email: 'ops@test.local', role: 'admin', clerkUserId: 'user_test' });
    }
    if (url.includes('/setup')) {
      return json({ ourIsaIds: [], hasIngested: false, firstRunComplete: true, desktopMode: false });
    }
    if (url.includes('/partners-config')) {
      return json({ items: [] });
    }
    if (url.includes('/channels')) {
      return json({ channels: [] });
    }
    return json({});
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test('shows setup progress when hub is incomplete', async () => {
  renderIndicator();
  const trigger = await screen.findByTestId('setup-progress-trigger');
  expect(trigger).toHaveTextContent('Setup: 0/4');
  fireEvent.click(trigger);
  expect(await screen.findByTestId('setup-progress-list')).toBeInTheDocument();
  expect(screen.getByTestId('setup-check-partner')).toHaveAttribute('href', '/partners-config');
});

test('hides when all setup checks pass', async () => {
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/me')) {
      return json({ id: 'u-1', email: 'ops@test.local', role: 'admin', clerkUserId: 'user_test' });
    }
    if (url.includes('/setup')) {
      return json({ ourIsaIds: ['ME'], hasIngested: true, firstRunComplete: true, desktopMode: false });
    }
    if (url.includes('/partners-config')) {
      return json({ items: [{ id: 'p1', isaSenderIds: ['ACME'], isaReceiverIds: [] }] });
    }
    if (url.includes('/channels')) {
      return json({ channels: [{ name: 'upload', source: 'upload', status: 'running' }] });
    }
    return json({});
  }));
  renderIndicator();
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByTestId('setup-progress-trigger')).toBeNull();
});
