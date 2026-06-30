import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { CommandPalette } from '../src/components/CommandPalette.tsx';
import { MeProvider } from '../src/lib/useRole.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
function jsonResponse(body: unknown): Promise<FakeResponse> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

// JSDOM doesn't implement HTMLDialogElement.showModal/close. Stub the two
// methods the palette calls so it can mount and "open" without throwing.
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { (this as HTMLDialogElement).setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      const ev = new Event('close');
      this.removeAttribute('open');
      this.dispatchEvent(ev);
    };
  }
});

function fakeFetch(input: unknown): Promise<FakeResponse> {
  const url = String(input);
  if (url.endsWith('/me')) {
    return jsonResponse({
      id: 'u-admin', email: 'admin@test.com', displayName: 'Admin',
      role: 'admin', clerkUserId: 'user_admin',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });
  }
  if (url.includes('/search')) {
    return jsonResponse({
      query: '12345',
      lifecycles: [
        { po: 'PO-12345', partnerDisplayName: 'Sysco', lastActivityAt: '2026-06-01T00:00:00Z', openAlertCount: 2 },
      ],
      transactions: [],
      rawFiles: [],
    });
  }
  return jsonResponse({});
}

function renderPalette(open = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <MeProvider orgId="test-org">
          <Routes>
            <Route path="*" element={
              <>
                <CommandPalette open={open} onClose={onClose} />
                <LocationSpy />
              </>
            } />
          </Routes>
        </MeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

function LocationSpy(): JSX.Element {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname}{search}</div>;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test('palette shows the static page list when first opened', async () => {
  renderPalette(true);
  // Pages are listed by their static labels.
  expect(await screen.findByText('Lifecycles')).toBeInTheDocument();
  expect(screen.getByText('Dashboard')).toBeInTheDocument();
  expect(screen.getByText('Alerts')).toBeInTheDocument();
});

test('typing filters the page list by substring', async () => {
  renderPalette(true);
  const input = await screen.findByTestId('command-palette-input');
  fireEvent.change(input, { target: { value: 'alert' } });
  // Only the Alerts entry matches "alert"; Dashboard and Lifecycles vanish.
  await waitFor(() => {
    expect(screen.getByText('Alerts')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });
});

test('Enter on the highlighted page navigates and closes the palette', async () => {
  const { onClose } = renderPalette(true);
  const input = await screen.findByTestId('command-palette-input');
  // Default selection is the first item (Lifecycles). Press Enter.
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => {
    expect(screen.getByTestId('location').textContent).toContain('/lifecycles');
  });
  expect(onClose).toHaveBeenCalled();
});

test('typing a search query surfaces lifecycle hits from /search', async () => {
  renderPalette(true);
  const input = await screen.findByTestId('command-palette-input');
  // Debounce is 180ms; advance after the keystroke.
  fireEvent.change(input, { target: { value: '12345' } });
  // Wait long enough for debounce + the fake fetch to resolve.
  await waitFor(() => {
    expect(screen.getByText('PO PO-12345')).toBeInTheDocument();
  }, { timeout: 1500 });
});
