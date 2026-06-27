/**
 * PartnersConfigPage — Phase 6 full partner editor.
 *
 * Sections in the editor:
 *  - Identity (display name, ISA arrays, status)
 *  - Supported sets (allow list; empty = accept anything)
 *  - Lifecycle flow (one or more partner-supplied flows; empty = shipped defaults)
 *  - Ack overrides (AK304 / AK403 / AK501 / AK901)
 *  - SLA windows (per setId + direction + withinMinutes)
 *  - Notes
 *  - Contacts (email-only)
 */
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CONNECTIVITY_CHANNELS,
  DEFAULT_GROCERY_FLOW,
  DEFAULT_STANDARD_FLOW,
  type ConnectivityChannel,
  type LifecycleFlowDefinition,
  type LifecycleFlowStep,
  type PartnerConfigInput,
  type PartnerConnectivity,
  type PartnerContact,
  type PartnerSlaWindow,
  type PartnerStatus,
  type TradingPartnerRecord,
  type AckCodeOverrides,
  type LifecycleDirection,
  type SegmentLabelOverrides,
} from '@edi/shared';
import { ApiCallError, api } from '../lib/api.ts';
import {
  PageHeader,
  DataTable,
  StatusPill,
  ErrorState,
  EmptyState,
  Skeleton,
  Card,
} from '../components/ui';
import { useToast } from '../lib/useToast.tsx';

/** Phase 8 Sprint 3 — local draft shape for the connectivity block.
 *  All four fields are strings so empty/blank handling is uniform — toInput
 *  decides whether to send the block or null on save. */
interface ConnectivityDraft {
  channel: ConnectivityChannel | '';
  endpoint: string;
  technicalContact: string;
  notes: string;
}

interface SegmentLabelRow {
  setId: string;
  segmentId: string;
  label: string;
}

const EMPTY_CONNECTIVITY: ConnectivityDraft = {
  channel: '', endpoint: '', technicalContact: '', notes: '',
};

interface DraftState {
  displayName: string;
  isaSenderIds: string;
  isaReceiverIds: string;
  status: PartnerStatus;
  notes: string;
  contacts: PartnerContact[];
  supportedSets: string;
  lifecycleFlows: LifecycleFlowDefinition[];
  ackCodeOverrides: AckCodeOverrides;
  slaWindows: PartnerSlaWindow[];
  slaCountdownEnabled: boolean;
  connectivity: ConnectivityDraft;
  segmentLabelRows: SegmentLabelRow[];
}

const EMPTY_DRAFT: DraftState = {
  displayName: '', isaSenderIds: '', isaReceiverIds: '',
  status: 'active', notes: '', contacts: [],
  supportedSets: '', lifecycleFlows: [], ackCodeOverrides: {}, slaWindows: [],
  slaCountdownEnabled: false,
  connectivity: EMPTY_CONNECTIVITY,
  segmentLabelRows: [],
};

function segmentRowsFromOverrides(o: SegmentLabelOverrides): SegmentLabelRow[] {
  return Object.entries(o).flatMap(([setId, segments]) =>
    Object.entries(segments).map(([segmentId, label]) => ({ setId, segmentId, label })),
  );
}

function overridesFromRows(rows: SegmentLabelRow[]): SegmentLabelOverrides {
  const out: SegmentLabelOverrides = {};
  for (const row of rows) {
    const setId = row.setId.trim();
    const segmentId = row.segmentId.trim();
    const label = row.label.trim();
    if (!setId || !segmentId || !label) continue;
    out[setId] ??= {};
    out[setId]![segmentId] = label;
  }
  return out;
}

function fromRecord(r: TradingPartnerRecord): DraftState {
  return {
    displayName: r.displayName,
    isaSenderIds: (r.isaSenderIds ?? []).join(', '),
    isaReceiverIds: (r.isaReceiverIds ?? []).join(', '),
    status: r.status,
    notes: r.notes ?? '',
    contacts: r.contacts ?? [],
    supportedSets: (r.supportedSets ?? []).join(', '),
    lifecycleFlows: r.lifecycleFlows ?? [],
    ackCodeOverrides: r.ackCodeOverrides ?? {},
    slaWindows: r.slaWindows ?? [],
    slaCountdownEnabled: r.slaCountdownEnabled ?? false,
    connectivity: r.connectivity
      ? {
          channel: r.connectivity.channel,
          endpoint: r.connectivity.endpoint,
          technicalContact: r.connectivity.technicalContact,
          notes: r.connectivity.notes ?? '',
        }
      : EMPTY_CONNECTIVITY,
    segmentLabelRows: segmentRowsFromOverrides(r.segmentLabelOverrides ?? {}),
  };
}

/** Phase 8 Sprint 3 — derive the wire-format connectivity from the draft.
 *  Returns:
 *   - undefined when the user cleared everything → server PATCH leaves the
 *     existing value alone (on create, the column lands as the default '{}').
 *   - null when explicitly cleared with at least one field touched then wiped
 *     (we choose to send `null` only when there was something there and the
 *     user emptied it; otherwise undefined is the safer default).
 *   - a full PartnerConnectivity object when channel + endpoint + contact
 *     are all populated. Partially-filled drafts produce a validation error
 *     server-side, which the UI surfaces inline. */
function draftConnectivityToInput(
  d: ConnectivityDraft,
): PartnerConnectivity | undefined {
  const channel = d.channel;
  const endpoint = d.endpoint.trim();
  const tech = d.technicalContact.trim();
  // Fully empty → omit from the patch entirely.
  if (!channel && !endpoint && !tech && !d.notes.trim()) return undefined;
  // Partial drafts are sent as-is; server validates and 400s with a useful
  // message. This is the same pattern the rest of the editor uses for SLAs.
  return {
    channel: channel as ConnectivityChannel,
    endpoint,
    technicalContact: tech,
    notes: d.notes.trim() ? d.notes.trim() : undefined,
  };
}

function toInput(d: DraftState): PartnerConfigInput {
  const split = (raw: string): string[] =>
    raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return {
    displayName: d.displayName.trim(),
    isaSenderIds: split(d.isaSenderIds),
    isaReceiverIds: split(d.isaReceiverIds),
    status: d.status,
    notes: d.notes.trim() ? d.notes.trim() : null,
    contacts: d.contacts.filter((c) => c.email.trim().length > 0),
    supportedSets: split(d.supportedSets),
    lifecycleFlows: d.lifecycleFlows,
    ackCodeOverrides: d.ackCodeOverrides,
    slaWindows: d.slaWindows,
    slaCountdownEnabled: d.slaCountdownEnabled,
    connectivity: draftConnectivityToInput(d.connectivity),
    segmentLabelOverrides: overridesFromRows(d.segmentLabelRows),
  };
}

export function PartnersConfigPage(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const listQ = useQuery({ queryKey: ['partners-config'], queryFn: () => api.partnersConfig.list() });
  const [editing, setEditing] = useState<{ id: string | null; draft: DraftState } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const saveM = useMutation({
    mutationFn: async (payload: { id: string | null; input: PartnerConfigInput }) =>
      payload.id
        ? api.partnersConfig.update(payload.id, payload.input)
        : api.partnersConfig.create(payload.input),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['partners-config'] });
      setEditing(null);
      setErrorMsg(null);
      toast.success(vars.id ? 'Partner saved' : 'Partner created');
    },
    onError: (err: unknown) => {
      if (err instanceof ApiCallError) {
        const body = err.body as { error?: { code?: string; message?: string } } | null;
        if (body?.error?.code === 'ISA_OVERLAP') {
          setErrorMsg('One or more ISA IDs already belong to another partner. Resolve the overlap and try again.');
          return;
        }
        if (body?.error?.message) {
          setErrorMsg(body.error.message);
          return;
        }
      }
      setErrorMsg('Could not save. Try again.');
    },
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => api.partnersConfig.remove(id),
    onSuccess: () => {
      toast.success('Partner deleted');
      void qc.invalidateQueries({ queryKey: ['partners-config'] });
    },
    onError: (err) => {
      toast.error('Could not delete partner', { description: err instanceof Error ? err.message : 'Server returned an error.' });
    },
  });

  function handleSubmit(ev: FormEvent<HTMLFormElement>): void {
    ev.preventDefault();
    if (!editing) return;
    saveM.mutate({ id: editing.id, input: toInput(editing.draft) });
  }

  const items = listQ.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Trading partners"
        subtitle="Identity, supported sets, lifecycle flow, ack overrides, SLA windows, and connectivity per partner."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => setEditing({ id: null, draft: { ...EMPTY_DRAFT } })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New partner
          </button>
        }
      />

      {listQ.isLoading ? (
        <Skeleton.Table rows={4} columnWidths={['20%', '20%', '15%', '10%', '10%', '12%', '13%']} />
      ) : listQ.isError ? (
        <ErrorState
          title="Could not load partners"
          description="The API isn't responding. Make sure the server is running and try again."
          action={<button className="btn" onClick={() => listQ.refetch()}>Retry</button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No partners configured yet"
          description={`Click "New partner" to add one.`}
        />
      ) : (
        <DataTable>
          <DataTable.Thead>
            <DataTable.Tr>
              <DataTable.Th>Name</DataTable.Th>
              <DataTable.Th>ISA senders</DataTable.Th>
              <DataTable.Th>Sets</DataTable.Th>
              <DataTable.Th>SLAs</DataTable.Th>
              <DataTable.Th>Channel</DataTable.Th>
              <DataTable.Th>Status</DataTable.Th>
              <DataTable.Th className="text-right">Actions</DataTable.Th>
            </DataTable.Tr>
          </DataTable.Thead>
          <DataTable.Tbody>
            {items.map((p: TradingPartnerRecord) => {
              const channel = p.connectivity?.channel;
              return (
                <DataTable.Tr key={p.id}>
                  <DataTable.Td>
                    <span className="font-semibold text-[var(--color-fg)]">{p.displayName}</span>
                  </DataTable.Td>
                  <DataTable.Td mono>{p.isaSenderIds.join(', ') || '—'}</DataTable.Td>
                  <DataTable.Td mono>
                    {p.supportedSets.length === 0 ? (
                      <span className="text-[var(--color-fg-subtle)]">any</span>
                    ) : (
                      p.supportedSets.join(', ')
                    )}
                  </DataTable.Td>
                  <DataTable.Td muted numeric>{p.slaWindows.length}</DataTable.Td>
                  <DataTable.Td>
                    {channel ? (
                      <StatusPill tone="brand" size="sm">{channel}</StatusPill>
                    ) : (
                      <span className="text-[var(--color-fg-subtle)]">—</span>
                    )}
                  </DataTable.Td>
                  <DataTable.Td>
                    <StatusPill tone={p.status === 'active' ? 'success' : 'neutral'} withDot>
                      {p.status}
                    </StatusPill>
                  </DataTable.Td>
                  <DataTable.Td className="text-right">
                    <button
                      type="button"
                      className="text-sm text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
                      onClick={() => setEditing({ id: p.id, draft: fromRecord(p) })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ml-3 text-sm text-[var(--color-error-700)] hover:underline"
                      onClick={() => {
                        if (window.confirm(`Delete partner "${p.displayName}"?`)) deleteM.mutate(p.id);
                      }}
                    >
                      Delete
                    </button>
                  </DataTable.Td>
                </DataTable.Tr>
              );
            })}
          </DataTable.Tbody>
        </DataTable>
      )}

      {editing ? (
        <Card className="mt-6">
          <form
            onSubmit={handleSubmit}
            className="space-y-5 p-4"
            data-testid="partner-editor"
          >
            <div className="border-b border-[var(--color-surface-border)] pb-3">
              <h2 className="text-sm font-semibold text-[var(--color-fg)]">
                {editing.id ? 'Edit partner' : 'New partner'}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">
                {editing.id
                  ? 'Update identity, supported sets, lifecycle flow, ack overrides, SLAs, connectivity, notes, and contacts.'
                  : 'Configure a new trading partner. Display name is required; everything else inherits sensible defaults.'}
              </p>
            </div>

          <Section title="Identity">
            <Field label="Display name">
              <input
                className="input"
                value={editing.draft.displayName}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, displayName: e.target.value } })}
                required
              />
            </Field>
            <Field label="ISA sender IDs (comma-separated)">
              <input
                className="input font-mono"
                value={editing.draft.isaSenderIds}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, isaSenderIds: e.target.value } })}
              />
            </Field>
            <Field label="ISA receiver IDs (comma-separated)">
              <input
                className="input font-mono"
                value={editing.draft.isaReceiverIds}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, isaReceiverIds: e.target.value } })}
              />
            </Field>
            <Field label="Status">
              <select
                className="select"
                value={editing.draft.status}
                onChange={(e) =>
                  setEditing({ ...editing, draft: { ...editing.draft, status: e.target.value as PartnerStatus } })
                }
              >
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </select>
            </Field>
          </Section>

          <Section title="Supported sets" hint="Comma-separated. Empty = accept anything (backward compat).">
            <input
              className="input font-mono"
              placeholder="850, 855, 810"
              value={editing.draft.supportedSets}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, supportedSets: e.target.value } })}
            />
          </Section>

          <Section title="Lifecycle flow" hint="Empty list = use shipped Standard / Grocery defaults.">
            <LifecycleFlowEditor
              flows={editing.draft.lifecycleFlows}
              onChange={(flows) => setEditing({ ...editing, draft: { ...editing.draft, lifecycleFlows: flows } })}
            />
          </Section>

          <Section title="Ack-code overrides" hint="Replace the X12 default wording for specific codes.">
            <AckOverridesEditor
              overrides={editing.draft.ackCodeOverrides}
              onChange={(o) => setEditing({ ...editing, draft: { ...editing.draft, ackCodeOverrides: o } })}
            />
          </Section>

          <Section title="SLA windows" hint="One row per (set, direction). withinMinutes is flat — calendar-aware is a Future Features item.">
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editing.draft.slaCountdownEnabled}
                onChange={(e) =>
                  setEditing({ ...editing, draft: { ...editing.draft, slaCountdownEnabled: e.target.checked } })
                }
              />
              Show SLA countdown on lifecycle rows for this partner
            </label>
            <SlaWindowsEditor
              rows={editing.draft.slaWindows}
              onChange={(rows) => setEditing({ ...editing, draft: { ...editing.draft, slaWindows: rows } })}
            />
          </Section>

          <Section
            title="Connectivity"
            hint="How this partner transmits. Credentials live in secrets — reference them by name in notes if needed."
          >
            <ConnectivityEditor
              value={editing.draft.connectivity}
              onChange={(connectivity) =>
                setEditing({ ...editing, draft: { ...editing.draft, connectivity } })
              }
            />
          </Section>

          <Section title="Segment label overrides" hint="Custom labels for Z-segments or non-standard elements (set → segment → label).">
            <SegmentLabelOverridesEditor
              rows={editing.draft.segmentLabelRows}
              onChange={(segmentLabelRows) => setEditing({ ...editing, draft: { ...editing.draft, segmentLabelRows } })}
            />
          </Section>

          <Section title="Notes">
            <textarea
              className="input"
              rows={3}
              value={editing.draft.notes}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, notes: e.target.value } })}
            />
          </Section>

          <Section title="Contacts" hint="Email-only for now; phone / Slack / on-call are tracked in BUILD_PLAN §12.">
            <ContactsEditor
              contacts={editing.draft.contacts}
              onChange={(contacts) => setEditing({ ...editing, draft: { ...editing.draft, contacts } })}
            />
          </Section>

            {errorMsg ? (
              <div className="rounded-md border border-[var(--color-error-500)]/30 bg-[var(--color-error-50)] px-3 py-2 text-xs text-[var(--color-error-700)]">
                {errorMsg}
              </div>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-[var(--color-surface-border)] pt-4">
              <button type="button" className="btn" onClick={() => { setEditing(null); setErrorMsg(null); }}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saveM.isPending}>
                {saveM.isPending ? 'Saving…' : editing.id ? 'Save changes' : 'Create partner'}
              </button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="border-t border-[var(--color-surface-border)] pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">{title}</h3>
      {hint ? <p className="mb-2 text-xs text-[var(--color-fg-subtle)]">{hint}</p> : null}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-fg-muted)]">
      {label}
      {children}
    </label>
  );
}

function LifecycleFlowEditor({
  flows,
  onChange,
}: {
  flows: LifecycleFlowDefinition[];
  onChange: (next: LifecycleFlowDefinition[]) => void;
}): JSX.Element {
  function addDefault(def: LifecycleFlowDefinition): void {
    onChange([...flows, { name: def.name, entrySetId: def.entrySetId, steps: def.steps.map((s) => ({ ...s })) }]);
  }
  return (
    <>
      {flows.map((f, i) => (
        <div key={i} className="rounded border border-[var(--color-surface-border)] p-3">
          <div className="grid grid-cols-12 gap-2">
            <input
              className="input col-span-5"
              placeholder="Flow name (e.g. Sysco standard)"
              value={f.name}
              onChange={(e) => {
                const next = [...flows];
                next[i] = { ...f, name: e.target.value };
                onChange(next);
              }}
            />
            <input
              className="input col-span-3 font-mono"
              placeholder="Entry set (e.g. 850)"
              value={f.entrySetId}
              onChange={(e) => {
                const next = [...flows];
                next[i] = { ...f, entrySetId: e.target.value };
                onChange(next);
              }}
            />
            <button
              type="button"
              className="col-span-2 text-xs text-[var(--color-error-700)] hover:underline"
              onClick={() => onChange(flows.filter((_, j) => j !== i))}
            >
              Remove flow
            </button>
          </div>
          <FlowStepsEditor
            steps={f.steps}
            onChange={(steps) => {
              const next = [...flows];
              next[i] = { ...f, steps };
              onChange(next);
            }}
          />
        </div>
      ))}
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          className="text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
          onClick={() => onChange([...flows, { name: '', entrySetId: '', steps: [] }])}
        >
          + Add empty flow
        </button>
        <button
          type="button"
          className="text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
          onClick={() => addDefault(DEFAULT_STANDARD_FLOW)}
        >
          + Add shipped Standard
        </button>
        <button
          type="button"
          className="text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
          onClick={() => addDefault(DEFAULT_GROCERY_FLOW)}
        >
          + Add shipped Grocery
        </button>
      </div>
    </>
  );
}

function FlowStepsEditor({ steps, onChange }: { steps: LifecycleFlowStep[]; onChange: (next: LifecycleFlowStep[]) => void }): JSX.Element {
  return (
    <div className="mt-2 space-y-1">
      {steps.map((st, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 text-xs">
          <input
            className="input col-span-4 font-mono"
            placeholder="Set ID"
            value={st.setId}
            onChange={(e) => {
              const next = [...steps];
              next[i] = { ...st, setId: e.target.value };
              onChange(next);
            }}
          />
          <select
            className="select col-span-4"
            value={st.direction}
            onChange={(e) => {
              const next = [...steps];
              next[i] = { ...st, direction: e.target.value as LifecycleDirection };
              onChange(next);
            }}
          >
            <option value="inbound">inbound</option>
            <option value="outbound">outbound</option>
            <option value="unknown">unknown</option>
          </select>
          <button type="button" className="col-span-2 text-[var(--color-error-700)] hover:underline" onClick={() => onChange(steps.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-xs text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
        onClick={() => onChange([...steps, { setId: '', direction: 'inbound' }])}
      >
        + Add step
      </button>
    </div>
  );
}

function AckOverridesEditor({
  overrides,
  onChange,
}: {
  overrides: AckCodeOverrides;
  onChange: (next: AckCodeOverrides) => void;
}): JSX.Element {
  const fields = ['AK304', 'AK403', 'AK501', 'AK901'] as const;
  return (
    <>
      {fields.map((field) => {
        const map = overrides[field] ?? {};
        return (
          <div key={field}>
            <div className="text-xs font-medium text-[var(--color-fg-muted)]">{field}</div>
            {Object.entries(map).map(([code, message]) => (
              <div key={code} className="mt-1 grid grid-cols-12 gap-2">
                <input
                  className="input col-span-2 font-mono"
                  value={code}
                  onChange={(e) => {
                    const newCode = e.target.value;
                    const { [code]: prev, ...rest } = map;
                    const next: AckCodeOverrides = { ...overrides, [field]: { ...rest, [newCode]: prev } };
                    onChange(next);
                  }}
                />
                <input
                  className="input col-span-9"
                  value={message}
                  onChange={(e) => {
                    const next: AckCodeOverrides = { ...overrides, [field]: { ...map, [code]: e.target.value } };
                    onChange(next);
                  }}
                />
                <button
                  type="button"
                  className="col-span-1 text-xs text-[var(--color-error-700)] hover:underline"
                  onClick={() => {
                    const { [code]: _gone, ...rest } = map;
                    const next: AckCodeOverrides = { ...overrides, [field]: rest };
                    onChange(next);
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="mt-1 text-xs text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
              onClick={() => onChange({ ...overrides, [field]: { ...map, '': '' } })}
            >
              + Add {field} override
            </button>
          </div>
        );
      })}
    </>
  );
}

function SegmentLabelOverridesEditor({
  rows,
  onChange,
}: {
  rows: SegmentLabelRow[];
  onChange: (next: SegmentLabelRow[]) => void;
}): JSX.Element {
  return (
    <div className="space-y-2" data-testid="segment-label-editor">
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 text-xs">
          <input
            className="input col-span-2 font-mono"
            placeholder="Set"
            value={row.setId}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...row, setId: e.target.value };
              onChange(next);
            }}
          />
          <input
            className="input col-span-3 font-mono"
            placeholder="Segment"
            value={row.segmentId}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...row, segmentId: e.target.value };
              onChange(next);
            }}
          />
          <input
            className="input col-span-6"
            placeholder="Display label"
            value={row.label}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...row, label: e.target.value };
              onChange(next);
            }}
          />
          <button
            type="button"
            className="col-span-1 text-[var(--color-error-700)] hover:underline"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-xs text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
        onClick={() => onChange([...rows, { setId: '', segmentId: '', label: '' }])}
      >
        + Add label override
      </button>
    </div>
  );
}

function SlaWindowsEditor({
  rows,
  onChange,
}: {
  rows: PartnerSlaWindow[];
  onChange: (next: PartnerSlaWindow[]) => void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 text-xs">
          <input
            className="input col-span-2 font-mono"
            placeholder="Set ID"
            value={r.setId}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...r, setId: e.target.value };
              onChange(next);
            }}
          />
          <select
            className="select col-span-2"
            value={r.direction}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...r, direction: e.target.value as LifecycleDirection };
              onChange(next);
            }}
          >
            <option value="inbound">inbound</option>
            <option value="outbound">outbound</option>
            <option value="unknown">unknown</option>
          </select>
          <input
            className="input col-span-3 font-mono"
            placeholder="withinMinutes"
            type="number"
            min={1}
            value={r.withinMinutes || ''}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...r, withinMinutes: Number(e.target.value) };
              onChange(next);
            }}
          />
          <input
            className="input col-span-4 font-mono"
            placeholder="expected ack set (default 997)"
            value={r.expectedAckSetId ?? ''}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...r, expectedAckSetId: e.target.value || undefined };
              onChange(next);
            }}
          />
          <button
            type="button"
            className="col-span-1 text-[var(--color-error-700)] hover:underline"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-xs text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
        onClick={() => onChange([...rows, { setId: '', direction: 'inbound', withinMinutes: 60 }])}
      >
        + Add SLA window
      </button>
    </div>
  );
}

function ContactsEditor({
  contacts,
  onChange,
}: {
  contacts: PartnerContact[];
  onChange: (next: PartnerContact[]) => void;
}): JSX.Element {
  return (
    <div className="space-y-3">
      {contacts.map((c, i) => (
        <div key={i} className="space-y-1 rounded border border-[var(--color-surface-border)] p-2">
          <div className="grid grid-cols-12 gap-2">
            <input
              className="input col-span-3"
              placeholder="Name"
              value={c.name}
              onChange={(e) => {
                const next = [...contacts];
                next[i] = { ...c, name: e.target.value };
                onChange(next);
              }}
            />
            <input
              className="input col-span-5 font-mono"
              placeholder="email@partner.com"
              value={c.email}
              onChange={(e) => {
                const next = [...contacts];
                next[i] = { ...c, email: e.target.value };
                onChange(next);
              }}
            />
            <input
              className="input col-span-3"
              placeholder="Role"
              value={c.role}
              onChange={(e) => {
                const next = [...contacts];
                next[i] = { ...c, role: e.target.value };
                onChange(next);
              }}
            />
            <button
              type="button"
              className="col-span-1 text-xs text-[var(--color-error-700)] hover:underline"
              onClick={() => onChange(contacts.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
          <div className="grid grid-cols-12 gap-2">
            <input
              className="input col-span-8 font-mono"
              placeholder="Slack incoming-webhook URL (optional)"
              value={c.slackWebhook ?? ''}
              onChange={(e) => {
                const next = [...contacts];
                next[i] = { ...c, slackWebhook: e.target.value || undefined };
                onChange(next);
              }}
            />
            <div className="col-span-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[var(--color-fg-muted)]">Alert types:</span>
              {(['MISSING_ACK', 'REJECTION_RATE_SPIKE'] as const).map((t) => {
                const enabled = c.alertTypeOptIns?.includes(t) ?? true; // empty = all
                return (
                  <label key={t} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => {
                        const current = c.alertTypeOptIns ?? ['MISSING_ACK', 'REJECTION_RATE_SPIKE'];
                        const nextOptIns = enabled
                          ? current.filter((x) => x !== t)
                          : [...current, t];
                        const next = [...contacts];
                        next[i] = { ...c, alertTypeOptIns: nextOptIns.length === 2 ? undefined : nextOptIns };
                        onChange(next);
                      }}
                    />
                    {t === 'MISSING_ACK' ? 'missing-ack' : 'rejection-spike'}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="text-xs text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
        onClick={() => onChange([...contacts, { name: '', email: '', role: '' }])}
      >
        + Add contact
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Phase 8 Sprint 3 — Connectivity editor
// ─────────────────────────────────────────────────────────────

function ConnectivityEditor({
  value,
  onChange,
}: {
  value: ConnectivityDraft;
  onChange: (next: ConnectivityDraft) => void;
}): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-12 gap-2">
        <Field label="Channel">
          <select
            className="input"
            data-testid="connectivity-channel"
            value={value.channel}
            onChange={(e) =>
              onChange({ ...value, channel: e.target.value as ConnectivityChannel | '' })
            }
          >
            <option value="">— Select —</option>
            {CONNECTIVITY_CHANNELS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
        <div className="col-span-7">
          <Field label="Endpoint">
            <input
              className="input font-mono"
              data-testid="connectivity-endpoint"
              placeholder="sftp://partner.example.com/in  or  https://partner.example.com/as2"
              value={value.endpoint}
              onChange={(e) => onChange({ ...value, endpoint: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <Field label="Technical contact (email)">
        <input
          className="input font-mono"
          data-testid="connectivity-tech-contact"
          placeholder="edi-ops@partner.example.com"
          value={value.technicalContact}
          onChange={(e) => onChange({ ...value, technicalContact: e.target.value })}
        />
      </Field>
      <Field label="Notes (operational, no credentials)">
        <textarea
          className="input"
          rows={2}
          data-testid="connectivity-notes"
          placeholder="e.g. cert rotates every 6 months; on-call rotation in PagerDuty schedule X"
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </Field>
    </div>
  );
}
