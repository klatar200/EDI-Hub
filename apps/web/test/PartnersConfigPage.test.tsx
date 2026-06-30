import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { PartnersConfigPage } from '../src/pages/PartnersConfigPage.tsx';
import { MeProvider } from '../src/lib/useRole.tsx';

interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
function jsonResponse(body: unknown, status = 200): Promise<FakeResponse> {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

const ADMIN_ME = {
  id: 'u-admin',
  email: 'admin@test.com',
  displayName: 'Admin',
  role: 'admin' as const,
  clerkUserId: 'user_admin',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const SAMPLE_LIST = {
  items: [
    {
      id: 'p1', tenantId: null, displayName: 'Sysco',
      isaSenderIds: ['SYSCO'], isaReceiverIds: [],
      status: 'active', notes: null, contacts: [],
      supportedSets: ['850', '855', '810'], lifecycleFlows: [], ackCodeOverrides: {}, slaWindows: [],
      segmentLabelOverrides: { '850': { ZZ: 'Custom ZZ label' } },
      // Phase 8 Sprint 3 — Sysco partner has a fully configured connectivity block.
      connectivity: {
        channel: 'AS2',
        endpoint: 'https://sysco.example.com/as2',
        technicalContact: 'edi-ops@sysco.example.com',
        notes: 'cert rotates every 6 months',
      },
      createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
    },
    {
      id: 'p2', tenantId: null, displayName: 'GFS',
      isaSenderIds: ['GFS'], isaReceiverIds: [],
      status: 'disabled', notes: 'paused 2026-06-05', contacts: [{ name: 'Jane', email: 'j@gfs.com', role: 'ops' }],
      supportedSets: [], lifecycleFlows: [], ackCodeOverrides: {},
      slaWindows: [{ setId: '850', direction: 'inbound', withinMinutes: 60 }],
      // GFS is intentionally unconfigured — proves the editor handles null cleanly.
      connectivity: null,
      createdAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-06-05T00:00:00.000Z',
    },
  ],
};

function fakeFetch(input: unknown): Promise<FakeResponse> {
  const url = String(input);
  if (url.endsWith('/me')) return jsonResponse(ADMIN_ME);
  if (url.includes('/partners-config')) return jsonResponse(SAMPLE_LIST);
  return jsonResponse({});
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MeProvider orgId="test-org">
          <PartnersConfigPage />
        </MeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn(fakeFetch)));
afterEach(() => vi.unstubAllGlobals());

test('lists configured partners with status and ISA arrays', async () => {
  renderPage();
  expect(await screen.findByText('Sysco')).toBeInTheDocument();
  // "GFS" appears in both the name column AND the ISA sender column —
  // assert by count instead of getByText.
  expect(screen.getAllByText('GFS').length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText('active').length).toBeGreaterThan(0);
  expect(screen.getAllByText('disabled').length).toBeGreaterThan(0);
});

test('clicking Edit opens an editor pre-filled with the partner record', async () => {
  renderPage();
  const editButtons = await screen.findAllByText('Edit');
  fireEvent.click(editButtons[0] as HTMLElement);
  // Editor is visible with the right title and pre-filled display name.
  expect(await screen.findByTestId('partner-editor')).toBeInTheDocument();
  expect(screen.getByText('Edit partner')).toBeInTheDocument();
  const nameInput = screen.getByDisplayValue('Sysco') as HTMLInputElement;
  expect(nameInput.value).toBe('Sysco');
});

test('clicking New partner opens a blank editor', async () => {
  renderPage();
  fireEvent.click(await screen.findByText('New partner'));
  // Scope the editor-visible assertions to the editor form itself; the page
  // header "New partner" button is also still in the DOM.
  const editor = await screen.findByTestId('partner-editor');
  expect(within(editor).getByText('New partner')).toBeInTheDocument();
  expect(within(editor).getByText('Create partner')).toBeInTheDocument();
});

test('editor renders SLA windows section with seeded row', async () => {
  renderPage();
  const editButtons = await screen.findAllByText('Edit');
  // Click the GFS edit button (second row) — that record has 1 SLA seeded.
  fireEvent.click(editButtons[1] as HTMLElement);
  const editor = await screen.findByTestId('partner-editor');
  // FO1 — editor is tabbed; SLA windows live on the "SLAs & alerts" tab.
  fireEvent.click(within(editor).getByTestId('editor-tab-slas'));
  expect(within(editor).getByText('SLA windows')).toBeInTheDocument();
  // The seeded withinMinutes value is bound to a number input.
  expect(within(editor).getByDisplayValue('60')).toBeInTheDocument();
});

test('editor renders Supported sets, Lifecycle flow, Ack overrides sections', async () => {
  renderPage();
  fireEvent.click(await screen.findByText('New partner'));
  const editor = await screen.findByTestId('partner-editor');
  // FO1 — Sets, lifecycle flow, and ack overrides all live on the "Sets & flow" tab.
  fireEvent.click(within(editor).getByTestId('editor-tab-sets'));
  expect(within(editor).getByText('Supported sets')).toBeInTheDocument();
  expect(within(editor).getByText('Lifecycle flow')).toBeInTheDocument();
  expect(within(editor).getByText('Ack-code overrides')).toBeInTheDocument();
});

// ─────────────────────────────────────────────────────────────
// Phase 8 Sprint 3 — Connectivity editor section
// ─────────────────────────────────────────────────────────────

test('editor renders the Connectivity section blank on a new partner', async () => {
  renderPage();
  fireEvent.click(await screen.findByText('New partner'));
  const editor = await screen.findByTestId('partner-editor');
  // FO1 — Connectivity is its own tab in the editor.
  fireEvent.click(within(editor).getByTestId('editor-tab-connectivity'));
  // Scope the "Connectivity" assertion to the active panel to avoid matching
  // the always-visible tab trigger of the same label.
  const panel = within(editor).getByRole('tabpanel', { name: /Connectivity/i });
  expect(within(panel).getByText('Connectivity')).toBeInTheDocument();
  // Channel select starts on the placeholder; endpoint + contact + notes are
  // empty inputs. Reaching for them by testid keeps the assertion stable as
  // styles evolve.
  const channel = within(editor).getByTestId('connectivity-channel') as HTMLSelectElement;
  const endpoint = within(editor).getByTestId('connectivity-endpoint') as HTMLInputElement;
  const tech = within(editor).getByTestId('connectivity-tech-contact') as HTMLInputElement;
  expect(channel.value).toBe('');
  expect(endpoint.value).toBe('');
  expect(tech.value).toBe('');
});

test('editor pre-fills Connectivity when editing a partner that has it configured', async () => {
  renderPage();
  const editButtons = await screen.findAllByText('Edit');
  // Sysco (first row) has connectivity in the fixture.
  fireEvent.click(editButtons[0] as HTMLElement);
  const editor = await screen.findByTestId('partner-editor');
  // FO1 — Connectivity is its own tab in the editor.
  fireEvent.click(within(editor).getByTestId('editor-tab-connectivity'));
  const channel = within(editor).getByTestId('connectivity-channel') as HTMLSelectElement;
  const endpoint = within(editor).getByTestId('connectivity-endpoint') as HTMLInputElement;
  const tech = within(editor).getByTestId('connectivity-tech-contact') as HTMLInputElement;
  expect(channel.value).toBe('AS2');
  expect(endpoint.value).toBe('https://sysco.example.com/as2');
  expect(tech.value).toBe('edi-ops@sysco.example.com');
});

test('editor shows segment label overrides from partner record', async () => {
  renderPage();
  const editButtons = await screen.findAllByText('Edit');
  fireEvent.click(editButtons[0] as HTMLElement);
  const editor = await screen.findByTestId('partner-editor');
  // FO1 — Segment-label overrides live alongside Supported sets / Lifecycle
  // flow / Ack overrides under the "Sets & flow" tab.
  fireEvent.click(within(editor).getByTestId('editor-tab-sets'));
  expect(within(editor).getByTestId('segment-label-editor')).toBeInTheDocument();
  expect(within(editor).getByDisplayValue('ZZ')).toBeInTheDocument();
  expect(within(editor).getByDisplayValue('Custom ZZ label')).toBeInTheDocument();
});

test('partners table flags setup gaps and readiness per partner', async () => {
  renderPage();
  await screen.findByText('Sysco');
  // Sysco has no SLA windows and no contacts → setup gaps surfaced.
  expect(screen.getByTestId('partner-setup-p1').textContent).toMatch(/gap/i);
  // GFS has ISA sender + SLA + a contact → ready.
  expect(screen.getByTestId('partner-setup-p2').textContent).toMatch(/ready/i);
});

