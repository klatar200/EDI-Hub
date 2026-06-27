/**
 * PS-1/PS-2 — Lifecycle-first homepage with expand-in-place timeline,
 * URL-reflected filters, expected-document warnings, and raw download.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { LifecycleListFilters, LifecycleFlow, LifecycleSummary } from '@edi/shared';
import { api } from '../lib/api.ts';
import { LifecycleTimeline } from '../components/LifecycleTimeline.tsx';
import { LifecycleExportMenu } from '../components/LifecycleExportMenu.tsx';
import {
  PinButton,
  SavedViewsBar,
  filtersToViewQuery,
  sortWithPinnedPos,
  usePinToggle,
} from '../components/LifecyclePreferencesBar.tsx';
import { useHasRole } from '../lib/useRole.tsx';
import {
  PageHeader,
  DataTable,
  StatusPill,
  Pagination,
  FilterChip,
  FilterChipRow,
  ErrorState,
  EmptyState,
  Skeleton,
  Card,
  FormField,
  Input,
  Select,
} from '../components/ui';

const PAGE_SIZE = 25;
const SETS = ['850', '855', '856', '860', '875', '880', '810', '997'];
const FLOWS: { value: LifecycleFlow; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'grocery', label: 'Grocery' },
  { value: 'unknown', label: 'Custom' },
];

const FLOW_LABEL: Record<LifecycleFlow, string> = {
  standard: 'Standard',
  grocery: 'Grocery',
  unknown: 'Custom',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function LifecycleNotes({ po }: { po: string }): JSX.Element {
  const qc = useQueryClient();
  const isOps = useHasRole('ops');
  const [draft, setDraft] = useState('');
  const notesQ = useQuery({ queryKey: ['lifecycle-notes', po], queryFn: () => api.lifecycleNotes.list(po) });
  const createM = useMutation({
    mutationFn: () => api.lifecycleNotes.create(po, { body: draft }),
    onSuccess: () => {
      setDraft('');
      void qc.invalidateQueries({ queryKey: ['lifecycle-notes', po] });
    },
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => api.lifecycleNotes.remove(po, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['lifecycle-notes', po] }),
  });
  return (
    <div className="mt-4 rounded-md border border-[var(--color-surface-border)] p-3" data-testid={`notes-${po}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">Ops notes</h4>
      <ul className="mt-2 space-y-2 text-sm">
        {(notesQ.data?.items ?? []).map((n) => (
          <li key={n.id} className="flex items-start gap-2 text-[var(--color-fg-muted)]">
            <span className="flex-1">
              <span className="text-[var(--color-fg)]">{n.body}</span>
              <span className="ml-2 text-xs">— {n.authorDisplayName ?? 'ops'}</span>
            </span>
            {isOps ? (
              <button
                type="button"
                className="text-xs text-[var(--color-error-600)] hover:underline disabled:opacity-50"
                data-testid={`delete-note-${n.id}`}
                disabled={deleteM.isPending}
                onClick={() => deleteM.mutate(n.id)}
              >
                Delete
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {isOps ? (
        <div className="mt-2 flex gap-2">
          <input
            className="flex-1 rounded border border-[var(--color-surface-border)] px-2 py-1 text-sm"
            placeholder="Add a note…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="button"
            className="rounded bg-[var(--color-brand-600)] px-3 py-1 text-sm text-white disabled:opacity-50"
            disabled={!draft.trim() || createM.isPending}
            onClick={() => createM.mutate()}
          >
            Save
          </button>
        </div>
      ) : null}
    </div>
  );
}

function LifecycleRow({
  row,
  showSlaColumn,
  selected,
  onToggleSelect,
  pinned,
  onTogglePin,
  pinDisabled,
}: {
  row: LifecycleSummary;
  showSlaColumn: boolean;
  selected: boolean;
  onToggleSelect: (po: string, checked: boolean) => void;
  pinned: boolean;
  onTogglePin: () => void;
  pinDisabled?: boolean;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const isOps = useHasRole('ops');
  const qc = useQueryClient();
  const expandQ = useQuery({
    queryKey: ['lifecycle', row.po],
    queryFn: () => api.lifecycle('po', row.po),
    enabled: expanded,
  });
  const reparseM = useMutation({
    mutationFn: (id: string) => api.reparseRaw(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lifecycle', row.po] });
      void qc.invalidateQueries({ queryKey: ['lifecycles'] });
    },
  });
  const parseErrorRawIds = [...new Set(
    (expandQ.data?.events ?? [])
      .map((e) => e.rawFileId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )];

  const warningTitle = row.expectedWarnings.length > 0 ? row.expectedWarnings.join('; ') : undefined;

  return (
    <>
      <DataTable.Tr data-testid={`lifecycle-row-${row.po}`}>
        <DataTable.Td>
          <PinButton po={row.po} pinned={pinned} onToggle={onTogglePin} disabled={pinDisabled} />
          <input
            type="checkbox"
            aria-label={`Select ${row.po}`}
            checked={selected}
            onChange={(e) => onToggleSelect(row.po, e.target.checked)}
          />
          <button
            type="button"
            className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded border border-[var(--color-surface-border)] text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-muted)]"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '−' : '+'}
          </button>
          <Link
            to={`/lifecycle/${encodeURIComponent(row.po)}`}
            className="font-medium text-[var(--color-fg)] underline decoration-[var(--color-surface-border)] underline-offset-2 hover:decoration-[var(--color-brand-500)]"
          >
            {row.po}
          </Link>
        </DataTable.Td>
        <DataTable.Td>{row.partnerDisplayName ?? '—'}</DataTable.Td>
        <DataTable.Td>
          <StatusPill tone="neutral" size="sm">{FLOW_LABEL[row.flow]}</StatusPill>
        </DataTable.Td>
        <DataTable.Td muted>{formatDate(row.startedAt)}</DataTable.Td>
        <DataTable.Td muted>{formatDate(row.lastActivityAt)}</DataTable.Td>
        {showSlaColumn ? (
          <DataTable.Td muted className="text-xs">
            {row.slaSummary ? (
              <span className={row.slaSummary.breached ? 'font-medium text-[var(--color-error-700)]' : ''}>
                {row.slaSummary.label}
              </span>
            ) : (
              '—'
            )}
          </DataTable.Td>
        ) : null}
        <DataTable.Td>
          <span className="tabular-nums">{row.received}</span>
          {row.missing > 0 ? (
            <span className="ml-1.5 inline-block" title={warningTitle}>
              <StatusPill tone="warn" size="sm">{row.missing} missing</StatusPill>
            </span>
          ) : null}
          {row.rejected > 0 ? (
            <span className="ml-1.5 inline-block">
              <StatusPill tone="error" size="sm">{row.rejected} rejected</StatusPill>
            </span>
          ) : null}
        </DataTable.Td>
        <DataTable.Td>
          {row.openAlertCount > 0 ? (
            <Link to="/alerts?hasAlerts=true" data-testid={`alert-badge-${row.po}`}>
              <StatusPill tone="error" size="sm" withDot>{row.openAlertCount}</StatusPill>
            </Link>
          ) : (
            <span className="text-[var(--color-fg-subtle)]">—</span>
          )}
        </DataTable.Td>
        <DataTable.Td>
          {row.hasParseError ? (
            <Link to="/ingestions?status=PARSE_ERROR" data-testid={`parse-error-badge-${row.po}`}>
              <StatusPill tone="warn" size="sm" withDot>Parse error</StatusPill>
            </Link>
          ) : row.hasDuplicates ? (
            <StatusPill tone="info" size="sm">+{row.additionalDocumentCount} extra</StatusPill>
          ) : row.expectedWarnings.length > 0 ? (
            <span title={warningTitle} data-testid={`expected-warning-${row.po}`}>
              <StatusPill tone="warn" size="sm" withDot>Expected doc</StatusPill>
            </span>
          ) : (
            <span className="text-[var(--color-fg-subtle)]">—</span>
          )}
        </DataTable.Td>
      </DataTable.Tr>
      {expanded ? (
        <DataTable.Tr>
          <DataTable.Td colSpan={showSlaColumn ? 9 : 8} className="bg-[var(--color-surface-muted)]/40">
            {expandQ.isLoading ? (
              <p className="py-3 text-sm text-[var(--color-fg-muted)]">Loading timeline…</p>
            ) : expandQ.isError || !expandQ.data ? (
              <p className="py-3 text-sm text-[var(--color-fg-muted)]">Could not load timeline.</p>
            ) : (
              <div className="py-3" data-testid={`expand-panel-${row.po}`}>
                {row.expectedWarnings.length > 0 ? (
                  <ul className="mb-3 space-y-1 rounded-md border border-[var(--color-warn-500)]/30 bg-[var(--color-warn-50)]/50 px-3 py-2 text-xs text-[var(--color-warn-800)]">
                    {row.expectedWarnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
                {row.hasParseError && isOps ? (
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" data-testid={`parse-retry-${row.po}`}>
                    <span className="text-[var(--color-fg-muted)]">Parse errors on this PO:</span>
                    {parseErrorRawIds.length > 0 ? (
                      parseErrorRawIds.map((id) => (
                        <button
                          key={id}
                          type="button"
                          className="rounded border border-[var(--color-surface-border)] px-2 py-0.5 text-xs hover:bg-[var(--color-surface-muted)]"
                          disabled={reparseM.isPending}
                          onClick={() => reparseM.mutate(id)}
                        >
                          Retry parse ({id.slice(0, 8)}…)
                        </button>
                      ))
                    ) : (
                      <Link to="/ingestions?status=PARSE_ERROR" className="text-[var(--color-brand-600)] hover:underline">
                        Open triage →
                      </Link>
                    )}
                  </div>
                ) : null}
                <LifecycleTimeline
                  events={expandQ.data.events}
                  po={expandQ.data.po}
                  showDownloadRaw
                  compact
                />
                <div className="mt-3">
                  <LifecycleExportMenu po={expandQ.data.po} />
                </div>
                <LifecycleNotes po={row.po} />
              </div>
            )}
          </DataTable.Td>
        </DataTable.Tr>
      ) : null}
    </>
  );
}

export function LifecyclesPage(): JSX.Element {
  const [sp, setSp] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeRawInZip, setIncludeRawInZip] = useState(false);
  const partnersConfigQ = useQuery({ queryKey: ['partners-config'], queryFn: () => api.partnersConfig.list() });
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() });
  const preferencesQ = useQuery({ queryKey: ['preferences'], queryFn: () => api.preferences.get() });
  const slaCountdownEnabled = settingsQ.data?.settings?.slaCountdownEnabled ?? false;
  const pinnedPos = preferencesQ.data?.preferences.pinnedPos ?? [];
  const { togglePin, isPending: pinPending } = usePinToggle(preferencesQ.data?.preferences);

  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const pinnedOnly = sp.get('pinnedOnly') === 'true';
  const sort: LifecycleListFilters['sort'] =
    sp.get('sort') === 'startedAt:asc' ? 'startedAt:asc' : 'startedAt:desc';
  const filters = {
    page,
    pageSize: PAGE_SIZE,
    partnerId: sp.get('partnerId') ?? undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    hasAlerts: sp.get('hasAlerts') === 'true' ? true : undefined,
    hasParseError: sp.get('hasParseError') === 'true' ? true : undefined,
    flow: (sp.get('flow') as LifecycleFlow | null) ?? undefined,
    setId: sp.get('setId') ?? undefined,
    setDirection: sp.get('setDirection') as 'inbound' | 'outbound' | undefined,
    pos: pinnedOnly && pinnedPos.length > 0 ? pinnedPos : undefined,
    sort,
  };

  const listQ = useQuery({
    queryKey: ['lifecycles', filters],
    queryFn: () => api.lifecycles(filters),
  });

  function setFilter(key: string, value: string | undefined): void {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setSp(next);
  }

  function clearAll(): void {
    setSp(new URLSearchParams());
  }

  function setPage(p: number): void {
    const next = new URLSearchParams(sp);
    if (p > 1) next.set('page', String(p));
    else next.delete('page');
    setSp(next);
  }

  function applySavedView(query: string): void {
    setSp(new URLSearchParams(query));
  }

  function setPinnedOnlyFilter(enabled: boolean): void {
    setFilter('pinnedOnly', enabled ? 'true' : undefined);
  }

  const rawItems = listQ.data?.items ?? [];
  const items = sortWithPinnedPos(rawItems, pinnedPos);
  const total = listQ.data?.total ?? 0;
  const showSlaColumn = slaCountdownEnabled || items.some((r) => r.slaSummary);
  const viewQuery = filtersToViewQuery(sp);
  const hasAnyFilter = Boolean(
    filters.partnerId || filters.from || filters.to || filters.hasAlerts
    || filters.hasParseError || filters.flow || filters.setId || filters.setDirection
    || pinnedOnly,
  );
  const partners = partnersConfigQ.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Lifecycles"
        subtitle="PO conversations — every related document in one place."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {selected.size > 0 ? (
              <>
                <label className="flex items-center gap-1.5 text-sm text-[var(--color-fg-muted)]">
                  <input
                    type="checkbox"
                    checked={includeRawInZip}
                    data-testid="export-include-raw"
                    onChange={(e) => setIncludeRawInZip(e.target.checked)}
                  />
                  Include raw EDI in ZIP
                </label>
                <button
                  type="button"
                  className="rounded border border-[var(--color-surface-border)] px-2 py-1 text-sm hover:bg-[var(--color-surface-muted)]"
                  onClick={() => void api.exportLifecyclesCsv({ pos: [...selected] })}
                >
                  Export CSV ({selected.size})
                </button>
                <button
                  type="button"
                  className="rounded border border-[var(--color-surface-border)] px-2 py-1 text-sm hover:bg-[var(--color-surface-muted)]"
                  data-testid="export-lifecycles-zip"
                  onClick={() => void api.exportLifecyclesZip([...selected], { includeRaw: includeRawInZip })}
                >
                  Export ZIP ({selected.size})
                </button>
              </>
            ) : null}
            <span className="text-sm text-[var(--color-fg-muted)] tabular-nums">
              {listQ.isLoading ? 'Loading…' : `${total} conversation${total === 1 ? '' : 's'}`}
            </span>
          </div>
        }
      />

      <Card className="mb-3">
        <div className="flex flex-wrap items-end gap-3 p-3">
          <FormField label="Partner">
            <Select
              size="sm"
              value={filters.partnerId ?? ''}
              onChange={(e) => setFilter('partnerId', e.target.value || undefined)}
            >
              <option value="">All</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Flow">
            <Select size="sm" value={filters.flow ?? ''} onChange={(e) => setFilter('flow', e.target.value || undefined)}>
              <option value="">All</option>
              {FLOWS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Doc type">
            <Select size="sm" value={filters.setId ?? ''} onChange={(e) => setFilter('setId', e.target.value || undefined)}>
              <option value="">All</option>
              {SETS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </FormField>
          <FormField label="Direction">
            <Select
              size="sm"
              value={filters.setDirection ?? ''}
              onChange={(e) => setFilter('setDirection', e.target.value || undefined)}
            >
              <option value="">Any</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </Select>
          </FormField>
          <FormField label="From">
            <Input size="sm" type="date" value={filters.from ?? ''} onChange={(e) => setFilter('from', e.target.value || undefined)} />
          </FormField>
          <FormField label="To">
            <Input size="sm" type="date" value={filters.to ?? ''} onChange={(e) => setFilter('to', e.target.value || undefined)} />
          </FormField>
          <FormField label="Sort">
            <Select
              size="sm"
              value={sort}
              data-testid="lifecycle-sort"
              onChange={(e) => setFilter('sort', e.target.value === 'startedAt:asc' ? 'startedAt:asc' : 'startedAt:desc')}
            >
              <option value="startedAt:desc">Started — newest first</option>
              <option value="startedAt:asc">Started — oldest first</option>
            </Select>
          </FormField>
          <FormField label="Alerts">
            <Select
              size="sm"
              value={filters.hasAlerts ? 'true' : ''}
              onChange={(e) => setFilter('hasAlerts', e.target.value || undefined)}
            >
              <option value="">All</option>
              <option value="true">With open alerts</option>
            </Select>
          </FormField>
          <FormField label="Parse errors">
            <Select
              size="sm"
              value={filters.hasParseError ? 'true' : ''}
              onChange={(e) => setFilter('hasParseError', e.target.value || undefined)}
            >
              <option value="">All</option>
              <option value="true">Parse errors only</option>
            </Select>
          </FormField>
        </div>
        {preferencesQ.data ? (
          <SavedViewsBar
            preferences={preferencesQ.data.preferences}
            currentQuery={viewQuery}
            pinnedOnly={pinnedOnly}
            onApplyView={applySavedView}
            onTogglePinnedOnly={setPinnedOnlyFilter}
          />
        ) : null}
      </Card>

      <FilterChipRow onClearAll={hasAnyFilter ? clearAll : undefined}>
        {filters.partnerId ? (
          <FilterChip
            key="partnerId"
            label="Partner"
            value={partners.find((p) => p.id === filters.partnerId)?.displayName ?? filters.partnerId}
            onRemove={() => setFilter('partnerId', undefined)}
          />
        ) : null}
        {filters.flow ? <FilterChip key="flow" label="Flow" value={FLOW_LABEL[filters.flow]} onRemove={() => setFilter('flow', undefined)} /> : null}
        {filters.setId ? <FilterChip key="setId" label="Set" value={filters.setId} onRemove={() => setFilter('setId', undefined)} /> : null}
        {filters.setDirection ? <FilterChip key="setDirection" label="Direction" value={filters.setDirection} onRemove={() => setFilter('setDirection', undefined)} /> : null}
        {filters.from ? <FilterChip key="from" label="From" value={filters.from} onRemove={() => setFilter('from', undefined)} /> : null}
        {filters.to ? <FilterChip key="to" label="To" value={filters.to} onRemove={() => setFilter('to', undefined)} /> : null}
        {filters.hasAlerts ? <FilterChip key="hasAlerts" label="Alerts" value="Open" onRemove={() => setFilter('hasAlerts', undefined)} /> : null}
        {filters.hasParseError ? <FilterChip key="hasParseError" label="Parse" value="Errors" onRemove={() => setFilter('hasParseError', undefined)} /> : null}
        {pinnedOnly ? <FilterChip key="pinnedOnly" label="Pinned" value="Only" onRemove={() => setFilter('pinnedOnly', undefined)} /> : null}
      </FilterChipRow>

      {listQ.isLoading ? (
        <Skeleton.Table rows={6} columnWidths={['18%', '14%', '10%', '14%', '14%', '14%', '8%', '8%']} />
      ) : listQ.isError ? (
        <ErrorState
          title="Could not load lifecycles"
          description="The API isn't responding. Make sure the server is running and try again."
          action={<button type="button" className="btn" onClick={() => listQ.refetch()}>Retry</button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={hasAnyFilter ? 'No conversations match these filters' : 'No PO conversations yet'}
          description={
            hasAnyFilter
              ? 'Try widening the filters above or clear them entirely.'
              : 'Once partners send EDI through the configured channels, PO lifecycles will appear here.'
          }
          action={hasAnyFilter ? <button type="button" className="btn" onClick={clearAll}>Clear filters</button> : null}
        />
      ) : (
        <>
          <DataTable>
            <DataTable.Thead>
              <DataTable.Tr>
                <DataTable.Th>PO</DataTable.Th>
                <DataTable.Th>Partner</DataTable.Th>
                <DataTable.Th>Flow</DataTable.Th>
                <DataTable.Th>Started</DataTable.Th>
                <DataTable.Th>Last activity</DataTable.Th>
                {showSlaColumn ? <DataTable.Th>SLA</DataTable.Th> : null}
                <DataTable.Th>Documents</DataTable.Th>
                <DataTable.Th>Alerts</DataTable.Th>
                <DataTable.Th>Flags</DataTable.Th>
              </DataTable.Tr>
            </DataTable.Thead>
            <DataTable.Tbody>
              {items.map((row) => (
                <LifecycleRow
                  key={row.po}
                  row={row}
                  showSlaColumn={showSlaColumn}
                  selected={selected.has(row.po)}
                  pinned={pinnedPos.includes(row.po)}
                  onTogglePin={() => togglePin(row.po)}
                  pinDisabled={pinPending}
                  onToggleSelect={(po, checked) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(po);
                      else next.delete(po);
                      return next;
                    });
                  }}
                />
              ))}
            </DataTable.Tbody>
          </DataTable>
          <Pagination
            offset={(page - 1) * PAGE_SIZE}
            limit={PAGE_SIZE}
            count={items.length}
            onChange={(o) => setPage(Math.floor(o / PAGE_SIZE) + 1)}
          />
        </>
      )}
    </div>
  );
}
