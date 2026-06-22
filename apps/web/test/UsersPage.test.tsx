/**
 * Phase 9 Sprint 3 — UsersPage + RequireRole rendering.
 *
 * Renders the page with three different /me responses (admin, ops, viewer)
 * and asserts that the role dropdown + Remove button are present only for
 * admin. Page itself renders for every role — read-only for non-admins.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { UsersPage } from '../src/pages/UsersPage.tsx';
import { MeProvider } from '../src/lib/useRole.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
const jsonRes = (body: unknown, status = 200): Promise<FakeResponse> =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

const USERS = {
  items: [
    { id: 'u-1', email: 'admin@x.com', displayName: 'Admin', role: 'admin', clerkUserId: 'user_1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'u-2', email: 'ops@x.com',   displayName: 'Ops',   role: 'ops',   clerkUserId: 'user_2', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
    { id: 'u-3', email: 'view@x.com',  displayName: 'View',  role: 'viewer',clerkUserId: 'user_3', createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z' },
  ],
};

function setFetchFor(meRole: 'admin' | 'ops' | 'viewer'): void {
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(input);
    if (url.endsWith('/me')) {
      return jsonRes({ id: meRole === 'admin' ? 'u-1' : meRole === 'ops' ? 'u-2' : 'u-3',
        email: `${meRole}@x.com`, displayName: meRole, role: meRole, clerkUserId: 'user_self',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    }
    if (url.endsWith('/users')) return jsonRes(USERS);
    return jsonRes({});
  }));
}

function renderPage(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MeProvider>
          <UsersPage />
        </MeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { /* setFetch called per test */ });
afterEach(() => vi.unstubAllGlobals());

test('admin sees role dropdowns and remove buttons', async () => {
  setFetchFor('admin');
  renderPage();
  // All three users render.
  await screen.findByText('admin@x.com');
  expect(screen.getByText('ops@x.com')).toBeInTheDocument();
  expect(screen.getByText('view@x.com')).toBeInTheDocument();
  // Role dropdowns visible for every user.
  await waitFor(() => {
    expect(screen.getByTestId('role-select-u-2')).toBeInTheDocument();
  });
  // Remove buttons visible for others (not self).
  expect(screen.getByTestId('remove-user-u-2')).toBeInTheDocument();
  expect(screen.queryByTestId('remove-user-u-1')).toBeNull(); // self
});

test('viewer sees the table but no role dropdowns and no remove buttons', async () => {
  setFetchFor('viewer');
  renderPage();
  await screen.findByText('admin@x.com');
  // Role appears as plain text, not a select.
  expect(screen.queryByTestId('role-select-u-1')).toBeNull();
  expect(screen.queryByTestId('role-select-u-2')).toBeNull();
  expect(screen.queryByTestId('remove-user-u-2')).toBeNull();
  // Plain-text roles still visible (read-only).
  expect(screen.getByText('admin')).toBeInTheDocument();
});

test('ops also gets the read-only view (admin-only affordances hidden)', async () => {
  setFetchFor('ops');
  renderPage();
  await screen.findByText('admin@x.com');
  expect(screen.queryByTestId('role-select-u-1')).toBeNull();
  expect(screen.queryByTestId('remove-user-u-1')).toBeNull();
});
