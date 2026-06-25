import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { FirstRunWizardPage } from '../src/pages/FirstRunWizardPage.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
function jsonResponse(body: unknown): Promise<FakeResponse> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

function fakeFetch(input: unknown): Promise<FakeResponse> {
  const url = String(input);
  if (url.includes('/health')) {
    return jsonResponse({
      status: 'ok',
      server: { port: 3000, redirectOrigins: ['http://127.0.0.1:3000'] },
    });
  }
  if (url.includes('/api/setup')) {
    return jsonResponse({
      firstRunComplete: false,
      dropFolderPath: null,
      telemetryEnabled: null,
      hasIngested: false,
      clerkRedirectVerified: false,
      desktopMode: true,
    });
  }
  return jsonResponse({});
}

function renderWizard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FirstRunWizardPage />
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

test('wizard step 1 shows welcome copy', () => {
  renderWizard();
  expect(screen.getByText(/Let's get your first file in/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Get started/i })).toBeInTheDocument();
});
