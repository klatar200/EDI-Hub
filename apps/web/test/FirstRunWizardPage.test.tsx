import { render, screen, fireEvent } from '@testing-library/react';
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
  if (url.includes('/api/setup')) {
    return jsonResponse({
      firstRunComplete: false,
      dropFolderPath: null,
      telemetryEnabled: null,
      hasIngested: false,
      clerkRedirectVerified: false,
      desktopMode: true,
      server: {
        port: 3000,
        redirectOrigins: ['http://127.0.0.1:3000', 'http://192.168.1.50:3000'],
      },
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

test('wizard clerk step lists LAN redirect origins', async () => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
  });
  renderWizard();
  fireEvent.click(screen.getByRole('button', { name: /Get started/i }));
  expect(await screen.findByText('http://192.168.1.50:3000')).toBeInTheDocument();
  expect(screen.getByText('Copy all LAN URLs')).toBeInTheDocument();
});
