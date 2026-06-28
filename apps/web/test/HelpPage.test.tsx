import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { HelpPage } from '../src/pages/HelpPage.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
function jsonResponse(body: unknown): Promise<FakeResponse> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

function fakeFetch(input: unknown): Promise<FakeResponse> {
  const url = String(input);
  if (url.includes('/api/setup')) {
    return jsonResponse({
      firstRunComplete: true,
      desktopMode: true,
      dropFolderPath: 'C:\\EDI',
      hasIngested: true,
      clerkRedirectVerified: true,
      telemetryEnabled: false,
      ourIsaIds: ['7085892400'],
      server: {
        port: 3000,
        redirectOrigins: ['http://127.0.0.1:3000', 'http://192.168.1.50:3000'],
      },
    });
  }
  return jsonResponse({});
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
  });
});
afterEach(() => vi.unstubAllGlobals());

test('help hub links to glossary and releases', async () => {
  renderPage();
  expect(await screen.findByText('Help')).toBeInTheDocument();
  expect(screen.getByText(/Open glossary/)).toHaveAttribute('href', '/help/transaction-sets');
  expect(screen.getByTestId('help-releases-link')).toHaveAttribute(
    'href',
    'https://github.com/klatar200/EDI-Hub/releases',
  );
});

test('desktop mode shows LAN URL and copy button', async () => {
  renderPage();
  const copyBtn = await screen.findByTestId('copy-lan-url');
  expect(copyBtn).toBeInTheDocument();
  expect(screen.getAllByText('http://192.168.1.50:3000').length).toBeGreaterThan(0);
  fireEvent.click(copyBtn);
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://192.168.1.50:3000');
});
