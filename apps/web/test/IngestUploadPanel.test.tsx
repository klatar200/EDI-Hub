import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { IngestUploadPanel } from '../src/components/IngestUploadPanel.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/ingest/upload') && init?.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'raw-new',
          s3Key: 'raw/x.edi',
          status: 'PARSED',
          fileHash: 'abc',
          isaControlNumber: '000000999',
          duplicate: false,
        }),
      } satisfies FakeResponse;
    }
    return { ok: true, status: 200, json: () => Promise.resolve({ items: [] }) };
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IngestUploadPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test('upload sends multipart file to ingest endpoint', async () => {
  renderPanel();
  const input = screen.getByTestId('ingest-file-input') as HTMLInputElement;
  const file = new File(['ISA*00*TEST~'], 'sample.edi', { type: 'application/edi-x12' });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByTestId('ingest-upload-results')).toBeInTheDocument());
  expect(screen.getByText('sample.edi')).toBeInTheDocument();
  expect(screen.getByText('Imported')).toBeInTheDocument();
  const fetchMock = vi.mocked(fetch);
  expect(fetchMock).toHaveBeenCalled();
  const uploadCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/ingest/upload'));
  expect(uploadCall).toBeDefined();
  expect(uploadCall![1]?.body).toBeInstanceOf(FormData);
});
