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
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CONNECTIVITY_CHANNELS,
  DEFAULT_GROCERY_FLOW,
  DEFAULT_STANDARD_FLOW,
  partnerSetupStatus,
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
import { RequireRole, useHasRole } from '../lib/useRole.tsx';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { PartnerMobileCards } from '../components/MobileTableCards.tsx';
import { usePreferMobileCards } from '../lib/useMediaQuery.ts';
import {
  PageHeader,
  DataTable,
  StatusPill,
  ErrorState,
  EmptyState,
  Skeleton,
  Card,
  Tabs,
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

// FO1 — editor section keys. Used to drive the Tabs primitive in the
// editor. Identity is the default landing tab. "Sets & flow" bundles the
// decoding-related editors (supported sets, lifecycle flow, ack-code
// overrides, segment-label overrides) since they all describe how the
// hub interprets transactions from this partner.
type EditorTab = 'identity' | 'sets' | 'slas' | 'connectivity' | 'notes';
const EDITOR_TABS: { value: EditorTab; label: string }[] = [
  { value: 'identity',     label: 'Identity' },
  { value: 'sets',         label: 'Sets & flow' },
  { value: 'slas',         label: 'SLAs & alerts' },
  { value: 'connectivity', label: 'Connectivity' },
  { value: 'notes',        label: 'Notes & contacts' },
];

// FO2 — inline field errors. Keys mirror the server validator's `field`
// path (apps/api/src/services/partners.ts → validatePartnerInput) so the
// same map type holds both client- and server-derived errors.
type FieldErrors = Partial<Record<
  | 'displayName'
  | 'isaSenderIds'
  | 'isaReceiverIds'
  | 'supportedSets'
  | 'lifecycleFlows'
  | 'slaWindows'
  | 'connectivity.channel'
  | 'connectivity.endpoint'
  | 'connectivity.technicalContact'
  | 'connectivity.notes'
  | 'slackWebhook',
  string
>>;

/** Map a field error key to the tab that hosts the offending control. Used
 *  to (a) jump to the first errored tab on submit and (b) badge tab
 *  triggers with an error count. */
function tabForField(field: keyof FieldErrors): EditorTab {
  if (field === 'displayName' || field === 'isaSenderIds' || field === 'isaReceiverIds') return 'identity';
  if (field === 'supportedSets' || field === 'lifecycleFlows') return 'sets';
  if (field === 'slaWindows') return 'slas';
  if (field.startsWith('connectivity.')) return 'connectivity';
  return 'notes'; // slackWebhook lives under Contacts (Notes & contacts).
}

/** Lightweight client-side mirror of the server validator. Catches the
 *  common cases inline so the operator doesn't have to round-trip to the
 *  API just to learn the display name is blank. The server still runs the
 *  authoritative validator on save. */
function validateDraft(draft: DraftState): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.displayName.trim()) {
    errors.displayName = 'Display name is required.';
  }
  const senders = draft.isaSenderIds.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (new Set(senders).size !== senders.length) {
    errors.isaSenderIds = 'Each ISA sender ID must be unique on this partner.';
  }
  const receivers = draft.isaReceiverIds.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (new Set(receivers).size !== receivers.length) {
    errors.isaReceiverIds = 'Each ISA receiver ID must be unique on this partner.';
  }
  for (const w of draft.slaWindows) {
    if (!w.setId.trim() || !Number.isInteger(w.withinMinutes) || w.withinMinutes <= 0) {
      errors.slaWindows = 'Every SLA window needs a set ID and a positive minute count.';
      break;
    }
  }
  // Connectivity is optional — but if the operator picked a channel, the
  // server requires endpoint + technicalContact (and the contact must look
  // like an email).
  const c = draft.connectivity;
  if (c.channel) {
    if (!c.endpoint.trim()) {
      errors['connectivity.endpoint'] = 'Endpoint is required when a channel is set.';
    }
    if (!c.technicalContact.trim()) {
      errors['connectivity.technicalContact'] = 'Technical contact is required when a channel is set.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.technicalContact.trim())) {
      errors['connectivity.technicalContact'] = 'Technical contact must look like an email address.';
    }
  }
  return errors;
}

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
  const isAdmin = useHasRole('admin');
  const preferMobileCards = usePreferMobileCards();
  const partnersConfigKey = useTenantQueryKey('partners-config');
  const listQ = useQuery({ queryKey: partnersConfigKey, queryFn: () => api.partnersConfig.list() });
  const [editing, setEditing] = useState<{ id: string | null; draft: DraftState } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // FO1 — editor is broken into 5 tabs. Reset to Identity whenever the
  // operator opens or switches between partners.
  const [editorTab, setEditorTab] = useState<EditorTab>('identity');
  // FO2 — inline field errors. Reset whenever the editor opens for a
  // different partner so a stale error from a previous edit doesn't
  // bleed into the next.
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // FO3 — snapshot of the draft at the moment the editor opened. Any
  // divergence from this is "unsaved changes" and guards the operator
  // against losing them. Stored as a serialized string to keep the diff
  // cheap and to match `JSON.stringify(draft)` comparison below.
  const [baselineDraft, setBaselineDraft] = useState<string | null>(null);
  useEffect(() => {
    if (editing) {
      setEditorTab('identity');
      setFieldErrors({});
      setBaselineDraft(JSON.stringify(editing.draft));
    } else {
      setBaselineDraft(null);
    }
  }, [editing?.id]);

  // FO3 — derive isDirty from baseline vs current draft.
  const isDirty = useMemo(() => {
    if (!editing || baselineDraft === null) return false;
    return JSON.stringify(editing.draft) !== baselineDraft;
  }, [editing, baselineDraft]);

  // FO3 — Browser-tab close / refresh / hard navigation. Modern browsers
  // ignore custom strings and show their own boilerplate; the listener
  // just needs to call preventDefault() and set returnValue to enable the
  // native "leave site?" prompt.
  useEffect(() => {
    if (!isDirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent): void {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  /** FO3 — single source of truth for "close this editor" prompts. Returns
   *  true when it's safe to proceed (no dirty state OR the operator
   *  confirmed). Falls through to `window.confirm` for the UI; tests can
   *  stub the global. */
  function confirmDiscard(message = 'Discard unsaved changes to this partner?'): boolean {
    if (!isDirty) return true;
    return window.confirm(message);
  }

  /** FO2 — replace a draft field and clear its inline error if any. Keeps
   *  the editor responsive: as soon as the operator types into an errored
   *  field, the red text disappears. */
  function updateDraft(patch: Partial<DraftState>, clearFields: (keyof FieldErrors)[] = []): void {
    if (!editing) return;
    setEditing({ ...editing, draft: { ...editing.draft, ...patch } });
    if (clearFields.length > 0) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        for (const f of clearFields) delete next[f];
        return next;
      });
    }
  }

  const saveM = useMutation({
    mutationFn: async (payload: { id: string | null; input: PartnerConfigInput }) =>
      payload.id
        ? api.partnersConfig.update(payload.id, payload.input)
        : api.partnersConfig.create(payload.input),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: partnersConfigKey });
      setEditing(null);
      setErrorMsg(null);
      toast.success(vars.id ? 'Partner saved' : 'Partner created');
    },
    onError: (err: unknown) => {
      if (err instanceof ApiCallError) {
        const body = err.body as {
          error?: { code?: string; message?: string; field?: string };
        } | null;
        if (body?.error?.code === 'ISA_OVERLAP') {
          // Cross-field conflict — keep at the top banner since it points
          // at a different partner's data, not this draft's field shape.
          setErrorMsg('One or more ISA IDs already belong to another partner. Resolve the overlap and try again.');
          return;
        }
        // FO2 — if the server points at a specific field, surface it inline
        // and jump to the tab that hosts it. Falls back to the banner when
        // the error has no field path.
        const field = body?.error?.field;
        const message = body?.error?.message;
        if (field && message) {
          const knownField = field as keyof FieldErrors;
          setFieldErrors((prev) => ({ ...prev, [knownField]: message }));
          setEditorTab(tabForField(knownField));
          setErrorMsg(null);
          return;
        }
        if (message) {
          setErrorMsg(message);
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
      void qc.invalidateQueries({ queryKey: partnersConfigKey });
    },
    onError: (err) => {
      toast.error('Could not delete partner', { description: err instanceof Error ? err.message : 'Server returned an error.' });
    },
  });

  function handleSubmit(ev: FormEvent<HTMLFormElement>): void {
    ev.preventDefault();
    if (!editing) return;
    // FO2 — run the client-side validator first. If anything fails, surface
    // inline errors, jump to the first errored tab, and skip the API call.
    const errors = validateDraft(editing.draft);
    const errorKeys = Object.keys(errors) as (keyof FieldErrors)[];
    if (errorKeys.length > 0) {
      setFieldErrors(errors);
      setErrorMsg(null);
      // Visit tabs in canonical order so we land on the earliest one with
      // an error — that matches the operator's left-to-right scan.
      const firstTab = EDITOR_TABS.find((t) => errorKeys.some((k) => tabForField(k) === t.value));
      if (firstTab) setEditorTab(firstTab.value);
      return;
    }
    setFieldErrors({});
    saveM.mutate({ id: editing.id, input: toInput(editing.draft) });
  }

  /** FO2 — count errors per tab so triggers can show a badge. */
  function errorCountForTab(tab: EditorTab): number {
    return (Object.keys(fieldErrors) as (keyof FieldErrors)[])
      .filter((k) => fieldErrors[k] && tabForField(k) === tab)
      .length;
  }

  const items = listQ.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Trading partners"
        subtitle="Identity, supported sets, lifecycle flow, ack overrides, SLA windows, and connectivity per partner."
        actions={
          <RequireRole role="admin">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                if (confirmDiscard()) setEditing({ id: null, draft: { ...EMPTY_DRAFT } });
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New partner
            </button>
          </RequireRole>
        }
      />

      {listQ.isLoading ? (
        <Skeleton.List rows={4} columnWidths={['20%', '20%', '15%', '10%', '10%', '12%', '13%']} />
      ) : listQ.isError ? (
        <ErrorState
          title="Could not load partners"
          description="The API isn't responding. Make sure the server is running and try again."
          action={<button className="btn" onClick={() => listQ.refetch()}>Retry</button>}
        />
      ) : items.length === 0 ? (
        // S2 — partners has no filters, so the only empty state is "no rows
        // configured yet." Admins get the same `New partner` CTA inline so
        // the next action is one click, not a hunt to the page header.
        // Viewers see a quieter explanation since they can't add partners.
        <EmptyState
          title="No partners configured yet"
          description={
            isAdmin
              ? 'Add the trading partners you exchange EDI with. Each partner carries its supported sets, SLA windows, and connectivity.'
              : 'No partners are configured for this organization yet. Ask an admin to add one.'
          }
          action={isAdmin ? (
            <button
              type="button"
              className="btn-primary"
              data-testid="empty-new-partner"
              onClick={() => {
                if (confirmDiscard()) setEditing({ id: null, draft: { ...EMPTY_DRAFT } });
              }}
            >
              Add partner
            </button>
          ) : null}
        />
      ) : (
        <>
          {preferMobileCards ? (
            <PartnerMobileCards
              items={items}
              isAdmin={isAdmin}
              onEdit={(p) => {
                if (confirmDiscard()) setEditing({ id: p.id, draft: fromRecord(p) });
              }}
            />
          ) : null}
          {preferMobileCards ? null : (
        <DataTable>
          <DataTable.Thead>
            <DataTable.Tr>
              <DataTable.Th>Name</DataTable.Th>
              <DataTable.Th>ISA senders</DataTable.Th>
              <DataTable.Th>Sets</DataTable.Th>
              <DataTable.Th>SLAs</DataTable.Th>
              <DataTable.Th>Setup</DataTable.Th>
              <DataTable.Th>Channel</DataTable.Th>
              <DataTable.Th>Status</DataTable.Th>
              {isAdmin ? <DataTable.Th className="text-right">Actions</DataTable.Th> : null}
            </DataTable.Tr>
          </DataTable.Thead>
          <DataTable.Tbody>
            {items.map((p: TradingPartnerRecord) => {
              const channel = p.connectivity?.channel;
              return (
                <DataTable.Tr key={p.id} className="group">
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
                    <PartnerSetupCell partner={p} />
                  </DataTable.Td>
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
                  {isAdmin ? (
                    <DataTable.Td className="text-right">
                      {/* T4 — Row actions hidden by default on hover-capable
                          devices; revealed on row hover or keyboard focus.
                          Stays visible on touch (no hover) and for screen
                          readers (opacity-0 doesn't hide from a11y tree). */}
                      <span className="inline-flex items-center justify-end gap-3 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          type="button"
                          className="text-sm text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30 rounded"
                          onClick={() => {
                            if (confirmDiscard()) setEditing({ id: p.id, draft: fromRecord(p) });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-sm text-[var(--color-error-700)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--color-error-500)]/30 rounded"
                          onClick={() => {
                            // FO3 — when the row being deleted is the one currently
                            // open in the editor, the unsaved-changes guard fires
                            // first (otherwise the delete would silently obliterate
                            // their draft along with the row).
                            const isCurrentlyEditing = editing?.id === p.id;
                            if (isCurrentlyEditing && !confirmDiscard()) return;
                            if (window.confirm(`Delete partner "${p.displayName}"?`)) deleteM.mutate(p.id);
                          }}
                        >
                          Delete
                        </button>
                      </span>
                    </DataTable.Td>
                  ) : null}
                </DataTable.Tr>
              );
            })}
          </DataTable.Tbody>
        </DataTable>
          )}
        </>
      )}

      {isAdmin && editing ? (
        <Card className="mt-6">
          <form
            onSubmit={handleSubmit}
            data-testid="partner-editor"
          >
            <div className="border-b border-[var(--color-surface-border)] px-4 pb-3 pt-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-[var(--color-fg)]">
                  {editing.id ? 'Edit partner' : 'New partner'}
                </h2>
                {/* FO3 — Visual cue that the operator has unsaved edits.
                    Pairs with the beforeunload + confirm-on-discard guards
                    so the dirty state isn't just felt, it's labeled. */}
                {isDirty ? (
                  <span
                    data-testid="partner-editor-dirty"
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warn-50)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-warn-800)]"
                  >
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-warn-500)]" />
                    Unsaved changes
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">
                {editing.id
                  ? 'Update identity, supported sets, lifecycle flow, ack overrides, SLAs, connectivity, notes, and contacts.'
                  : 'Configure a new trading partner. Display name is required; everything else inherits sensible defaults.'}
              </p>
            </div>

            <div className="space-y-4 px-4 pt-4">
              <PartnerSetupBanner input={toInput(editing.draft)} />
            </div>

            {/* FO1 — Tabbed editor. The 9 sections are grouped by intent:
                Identity / Sets & flow / SLAs & alerts / Connectivity /
                Notes & contacts. Panels stay mounted (Tabs hides inactive
                with `hidden`) so the draft state in each tab is preserved
                across switches without lifting fields. */}
            <Tabs value={editorTab} onValueChange={(v) => setEditorTab(v as EditorTab)} className="mt-4">
              <Tabs.List ariaLabel="Partner editor sections" className="px-4">
                {EDITOR_TABS.map((t) => {
                  const count = errorCountForTab(t.value);
                  return (
                    <Tabs.Trigger key={t.value} value={t.value} testId={`editor-tab-${t.value}`}>
                      {t.label}
                      {/* FO2 — error-count badge surfaces inline-validation
                          state from tabs the operator isn't currently viewing. */}
                      {count > 0 ? (
                        <span
                          aria-label={`${count} error${count === 1 ? '' : 's'}`}
                          data-testid={`editor-tab-error-${t.value}`}
                          className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--color-error-500)] px-1 text-[10px] font-bold leading-none text-white"
                        >
                          {count}
                        </span>
                      ) : null}
                    </Tabs.Trigger>
                  );
                })}
              </Tabs.List>

              <Tabs.Panel value="identity" className="space-y-5 px-4 py-5">
                <Section title="Identity">
                  <Field label="Display name" required error={fieldErrors.displayName}>
                    <input
                      className="input"
                      value={editing.draft.displayName}
                      onChange={(e) => updateDraft({ displayName: e.target.value }, ['displayName'])}
                      aria-invalid={fieldErrors.displayName ? true : undefined}
                      aria-required="true"
                    />
                  </Field>
                  <Field label="ISA sender IDs (comma-separated)" error={fieldErrors.isaSenderIds}>
                    <input
                      className="input font-mono"
                      value={editing.draft.isaSenderIds}
                      onChange={(e) => updateDraft({ isaSenderIds: e.target.value }, ['isaSenderIds'])}
                      aria-invalid={fieldErrors.isaSenderIds ? true : undefined}
                    />
                  </Field>
                  <Field label="ISA receiver IDs (comma-separated)" error={fieldErrors.isaReceiverIds}>
                    <input
                      className="input font-mono"
                      value={editing.draft.isaReceiverIds}
                      onChange={(e) => updateDraft({ isaReceiverIds: e.target.value }, ['isaReceiverIds'])}
                      aria-invalid={fieldErrors.isaReceiverIds ? true : undefined}
                    />
                  </Field>
                  <Field label="Status">
                    <select
                      className="select"
                      value={editing.draft.status}
                      onChange={(e) => updateDraft({ status: e.target.value as PartnerStatus })}
                    >
                      <option value="active">active</option>
                      <option value="disabled">disabled</option>
                    </select>
                  </Field>
                </Section>
              </Tabs.Panel>

              <Tabs.Panel value="sets" className="space-y-5 px-4 py-5">
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

                <Section title="Segment label overrides" hint="Custom labels for Z-segments or non-standard elements (set → segment → label).">
                  <SegmentLabelOverridesEditor
                    rows={editing.draft.segmentLabelRows}
                    onChange={(segmentLabelRows) => setEditing({ ...editing, draft: { ...editing.draft, segmentLabelRows } })}
                  />
                </Section>
              </Tabs.Panel>

              <Tabs.Panel value="slas" className="space-y-5 px-4 py-5">
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
                  {fieldErrors.slaWindows ? (
                    <p
                      role="alert"
                      data-testid="error-slaWindows"
                      className="mb-2 rounded-md border border-[var(--color-error-500)]/30 bg-[var(--color-error-50)] px-3 py-1.5 text-xs text-[var(--color-error-700)]"
                    >
                      {fieldErrors.slaWindows}
                    </p>
                  ) : null}
                  <SlaWindowsEditor
                    rows={editing.draft.slaWindows}
                    onChange={(rows) => updateDraft({ slaWindows: rows }, ['slaWindows'])}
                  />
                </Section>
              </Tabs.Panel>

              <Tabs.Panel value="connectivity" className="space-y-5 px-4 py-5">
                <Section
                  title="Connectivity"
                  hint="How this partner transmits. Credentials live in secrets — reference them by name in notes if needed."
                >
                  <ConnectivityEditor
                    value={editing.draft.connectivity}
                    errors={fieldErrors}
                    onFieldChange={(clear) =>
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        for (const f of clear) delete next[f];
                        return next;
                      })
                    }
                    onChange={(connectivity) =>
                      setEditing({ ...editing, draft: { ...editing.draft, connectivity } })
                    }
                  />
                </Section>
              </Tabs.Panel>

              <Tabs.Panel value="notes" className="space-y-5 px-4 py-5">
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
              </Tabs.Panel>
            </Tabs>

            {/* FO1 — Sticky save bar pins Cancel + Save to the bottom of
                the viewport while the operator scrolls through long
                editors (Lifecycle flow + SLA windows + Contacts can each
                be many rows). `sticky bottom-0` works because the Card
                doesn't establish a sticky-scroll ancestor. */}
            <div
              className="safe-area-bottom sticky bottom-0 z-10 mt-2 flex flex-wrap items-center justify-end gap-3 border-t border-[var(--color-surface-border)] bg-[var(--color-surface-card)]/95 px-4 py-3 backdrop-blur"
              data-testid="partner-editor-save-bar"
            >
              {/* FO2 — Field-level problems are shown inline next to the offending
                  control, not in the save bar. The save bar is reserved for
                  top-level messages (cross-partner conflicts, network errors)
                  and a quiet count of pending inline errors. */}
              {Object.keys(fieldErrors).length > 0 ? (
                <p
                  className="mr-auto text-xs text-[var(--color-error-700)]"
                  data-testid="editor-error-summary"
                  role="status"
                >
                  Fix {Object.keys(fieldErrors).length} field
                  {Object.keys(fieldErrors).length === 1 ? '' : 's'} before saving.
                </p>
              ) : errorMsg ? (
                <div
                  className="mr-auto max-w-md rounded-md border border-[var(--color-error-500)]/30 bg-[var(--color-error-50)] px-3 py-1.5 text-xs text-[var(--color-error-700)]"
                  role="alert"
                >
                  {errorMsg}
                </div>
              ) : null}
              <button
                type="button"
                className="btn"
                data-testid="partner-editor-cancel"
                onClick={() => {
                  // FO3 — Cancel is the most common discard path; guard it.
                  if (!confirmDiscard()) return;
                  setEditing(null);
                  setErrorMsg(null);
                  setFieldErrors({});
                }}
              >
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

function PartnerSetupCell({ partner }: { partner: TradingPartnerRecord }): JSX.Element {
  const setup = partnerSetupStatus(partner);
  const title = setup.gaps.length
    ? setup.gaps.map((g) => `• ${g.label}: ${g.hint}`).join('\n')
    : 'All recommended settings are configured.';
  return (
    <span data-testid={`partner-setup-${partner.id}`} title={title}>
      {setup.status === 'ready' ? (
        <StatusPill tone="success" size="sm">Ready</StatusPill>
      ) : (
        <StatusPill
          tone={setup.status === 'error' ? 'error' : setup.status === 'warn' ? 'warn' : 'info'}
          size="sm"
          withDot
        >
          {setup.gaps.length} gap{setup.gaps.length === 1 ? '' : 's'}
        </StatusPill>
      )}
    </span>
  );
}

function PartnerSetupBanner({ input }: { input: PartnerConfigInput }): JSX.Element {
  // `slaWindows` and `contacts` are optional on PartnerConfigInput (PATCH
  // bodies omit them to keep the current value). `partnerSetupStatus` only
  // reads `.length`, so coerce `undefined` to an empty array — strict tsc
  // build flags the optional-vs-required mismatch otherwise.
  const setup = partnerSetupStatus({
    isaSenderIds: input.isaSenderIds,
    slaWindows: input.slaWindows ?? [],
    contacts: input.contacts ?? [],
  });
  if (setup.status === 'ready') {
    return (
      <div
        className="rounded-md border border-[var(--color-success-500)]/30 bg-[var(--color-success-50)] px-3 py-2 text-xs text-[var(--color-success-700)]"
        data-testid="partner-setup-banner"
      >
        Setup complete — this partner is fully configured ({setup.total}/{setup.total}).
      </div>
    );
  }
  return (
    <div
      className="rounded-md border border-[var(--color-warn-500)]/30 bg-[var(--color-warn-50)] px-3 py-2 text-xs text-[var(--color-warn-800)]"
      data-testid="partner-setup-banner"
    >
      <p className="font-medium">Setup: {setup.doneCount} of {setup.total} configured</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {setup.gaps.map((g) => (
          <li key={g.id}><span className="font-medium">{g.label}:</span> {g.hint}</li>
        ))}
      </ul>
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

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  /** FO2 — mark the field with a subtle `*` and add `aria-required`. */
  required?: boolean;
  /** FO2 — per-field error message; renders inline below the control and
   *  flips the wrapper's color to error. */
  error?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-fg-muted)]">
      <span aria-required={required ?? undefined}>
        {label}
        {required ? (
          <span className="ml-0.5 text-[var(--color-error-500)]" aria-hidden>*</span>
        ) : null}
      </span>
      {children}
      {error ? (
        <span role="alert" className="text-xs font-normal text-[var(--color-error-700)]">
          {error}
        </span>
      ) : null}
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
          <div className="grid grid-cols-1 gap-2 md:grid-cols-6 lg:grid-cols-12">
            <input
              className="input col-span-full md:col-span-3 lg:col-span-5"
              placeholder="Flow name (e.g. Sysco standard)"
              value={f.name}
              onChange={(e) => {
                const next = [...flows];
                next[i] = { ...f, name: e.target.value };
                onChange(next);
              }}
            />
            <input
              className="input col-span-full md:col-span-3 lg:col-span-3 font-mono"
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
              className="col-span-full md:col-span-2 lg:col-span-2 text-xs text-[var(--color-error-700)] hover:underline"
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
        <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-6 lg:grid-cols-12 text-xs">
          <input
            className="input col-span-full md:col-span-3 lg:col-span-4 font-mono"
            placeholder="Set ID"
            value={st.setId}
            onChange={(e) => {
              const next = [...steps];
              next[i] = { ...st, setId: e.target.value };
              onChange(next);
            }}
          />
          <select
            className="select col-span-full md:col-span-3 lg:col-span-4"
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
          <button type="button" className="col-span-full md:col-span-2 lg:col-span-2 text-[var(--color-error-700)] hover:underline" onClick={() => onChange(steps.filter((_, j) => j !== i))}>
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
              <div key={code} className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-6 lg:grid-cols-12">
                <input
                  className="input col-span-full md:col-span-2 lg:col-span-2 font-mono"
                  value={code}
                  onChange={(e) => {
                    const newCode = e.target.value;
                    const { [code]: prev, ...rest } = map;
                    const next: AckCodeOverrides = { ...overrides, [field]: { ...rest, [newCode]: prev } };
                    onChange(next);
                  }}
                />
                <input
                  className="input col-span-full md:col-span-6 lg:col-span-9"
                  value={message}
                  onChange={(e) => {
                    const next: AckCodeOverrides = { ...overrides, [field]: { ...map, [code]: e.target.value } };
                    onChange(next);
                  }}
                />
                <button
                  type="button"
                  className="col-span-full md:col-span-1 lg:col-span-1 text-xs text-[var(--color-error-700)] hover:underline"
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
        <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-6 lg:grid-cols-12 text-xs">
          <input
            className="input col-span-full md:col-span-2 lg:col-span-2 font-mono"
            placeholder="Set"
            value={row.setId}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...row, setId: e.target.value };
              onChange(next);
            }}
          />
          <input
            className="input col-span-full md:col-span-3 lg:col-span-3 font-mono"
            placeholder="Segment"
            value={row.segmentId}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...row, segmentId: e.target.value };
              onChange(next);
            }}
          />
          <input
            className="input col-span-full md:col-span-3 lg:col-span-6"
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
            className="col-span-full md:col-span-1 lg:col-span-1 text-[var(--color-error-700)] hover:underline"
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
        <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-6 lg:grid-cols-12 text-xs">
          <input
            className="input col-span-full md:col-span-2 lg:col-span-2 font-mono"
            placeholder="Set ID"
            value={r.setId}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...r, setId: e.target.value };
              onChange(next);
            }}
          />
          <select
            className="select col-span-full md:col-span-2 lg:col-span-2"
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
            className="input col-span-full md:col-span-3 lg:col-span-3 font-mono"
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
            className="input col-span-full md:col-span-3 lg:col-span-4 font-mono"
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
            className="col-span-full md:col-span-1 lg:col-span-1 text-[var(--color-error-700)] hover:underline"
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
          <div className="grid grid-cols-1 gap-2 md:grid-cols-6 lg:grid-cols-12">
            <input
              className="input col-span-full md:col-span-3 lg:col-span-3"
              placeholder="Name"
              value={c.name}
              onChange={(e) => {
                const next = [...contacts];
                next[i] = { ...c, name: e.target.value };
                onChange(next);
              }}
            />
            <input
              className="input col-span-full md:col-span-3 lg:col-span-5 font-mono"
              placeholder="email@partner.com"
              value={c.email}
              onChange={(e) => {
                const next = [...contacts];
                next[i] = { ...c, email: e.target.value };
                onChange(next);
              }}
            />
            <input
              className="input col-span-full md:col-span-3 lg:col-span-3"
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
              className="col-span-full md:col-span-1 lg:col-span-1 text-xs text-[var(--color-error-700)] hover:underline"
              onClick={() => onChange(contacts.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-6 lg:grid-cols-12">
            <input
              className="input col-span-full md:col-span-6 lg:col-span-8 font-mono"
              placeholder="Slack incoming-webhook URL (optional)"
              value={c.slackWebhook ?? ''}
              onChange={(e) => {
                const next = [...contacts];
                next[i] = { ...c, slackWebhook: e.target.value || undefined };
                onChange(next);
              }}
            />
            <div className="col-span-full md:col-span-3 lg:col-span-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[var(--color-fg-muted)]">Alert types:</span>
              {(['MISSING_ACK', 'REJECTION_RATE_SPIKE', 'STALE_TRAFFIC', 'UNKNOWN_ISA'] as const).map((t) => {
                const enabled = c.alertTypeOptIns?.includes(t) ?? true; // empty = all
                const label =
                  t === 'MISSING_ACK' ? 'missing-ack'
                  : t === 'REJECTION_RATE_SPIKE' ? 'rejection-spike'
                  : t === 'STALE_TRAFFIC' ? 'stale-traffic'
                  : 'unknown-isa';
                return (
                  <label key={t} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => {
                        const all = ['MISSING_ACK', 'REJECTION_RATE_SPIKE', 'STALE_TRAFFIC', 'UNKNOWN_ISA'] as const;
                        const current = c.alertTypeOptIns ?? [...all];
                        const nextOptIns = enabled
                          ? current.filter((x) => x !== t)
                          : [...current, t];
                        const next = [...contacts];
                        next[i] = {
                          ...c,
                          alertTypeOptIns: nextOptIns.length === all.length ? undefined : [...nextOptIns],
                        };
                        onChange(next);
                      }}
                    />
                    {label}
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
  errors,
  onFieldChange,
}: {
  value: ConnectivityDraft;
  onChange: (next: ConnectivityDraft) => void;
  /** FO2 — per-field validation errors. Mark endpoint and technicalContact
   *  as required only once the operator has chosen a channel. */
  errors?: Pick<FieldErrors, 'connectivity.channel' | 'connectivity.endpoint' | 'connectivity.technicalContact' | 'connectivity.notes'>;
  /** Optional callback so the parent can clear specific field errors as
   *  the operator edits — keeps the inline-error UX responsive. */
  onFieldChange?: (clear: (keyof FieldErrors)[]) => void;
}): JSX.Element {
  const channelChosen = value.channel !== '';
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-6 lg:grid-cols-12">
        <div className="col-span-full md:col-span-2 lg:col-span-2">
        <Field label="Channel" error={errors?.['connectivity.channel']}>
          <select
            className="input"
            data-testid="connectivity-channel"
            value={value.channel}
            aria-invalid={errors?.['connectivity.channel'] ? true : undefined}
            onChange={(e) => {
              onChange({ ...value, channel: e.target.value as ConnectivityChannel | '' });
              onFieldChange?.(['connectivity.channel', 'connectivity.endpoint', 'connectivity.technicalContact']);
            }}
          >
            <option value="">— Select —</option>
            {CONNECTIVITY_CHANNELS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
        </div>
        <div className="col-span-full md:col-span-4 lg:col-span-7">
          <Field
            label="Endpoint"
            required={channelChosen}
            error={errors?.['connectivity.endpoint']}
          >
            <input
              className="input font-mono"
              data-testid="connectivity-endpoint"
              placeholder="sftp://partner.example.com/in  or  https://partner.example.com/as2"
              value={value.endpoint}
              aria-invalid={errors?.['connectivity.endpoint'] ? true : undefined}
              onChange={(e) => {
                onChange({ ...value, endpoint: e.target.value });
                onFieldChange?.(['connectivity.endpoint']);
              }}
            />
          </Field>
        </div>
      </div>
      <Field
        label="Technical contact (email)"
        required={channelChosen}
        error={errors?.['connectivity.technicalContact']}
      >
        <input
          className="input font-mono"
          data-testid="connectivity-tech-contact"
          placeholder="edi-ops@partner.example.com"
          value={value.technicalContact}
          aria-invalid={errors?.['connectivity.technicalContact'] ? true : undefined}
          onChange={(e) => {
            onChange({ ...value, technicalContact: e.target.value });
            onFieldChange?.(['connectivity.technicalContact']);
          }}
        />
      </Field>
      <Field label="Notes (operational, no credentials)" error={errors?.['connectivity.notes']}>
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
