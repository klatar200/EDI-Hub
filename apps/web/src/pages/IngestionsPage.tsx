/**
 * UI Phase Sprint 2.5 — Ingestions page, polished.
 *
 * Lists raw EDI files in arrival order. ISA control number is mono
 * (it's a 9-digit identifier the operator reads digit-by-digit). Status
 * pills replace the bespoke StatusBadge. Empty / error / skeleton
 * states use the shared primitives.
 *
 * Ops users can import files via the upload panel; viewers see the list only.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { RawFileRecord } from '@edi/shared';
import { api } from '../lib/api.ts';
import { buildParseErrorReport } from '../lib/parse-error-report.ts';
import { IngestUploadPanel } from '../components/IngestUploadPanel.tsx';
import { IngestionMobileCards } from '../components/MobileTableCards.tsx';
import { usePreferMobileCards } from '../lib/useMediaQuery.ts';
import { RequireRole, useHasRole } from '../lib/useRole.tsx';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { useToast } from '../lib/useToast.tsx';
import {
  PageHeader,
  DataTable,
  StatusPill,
  rawFileTone,
  ErrorState,
  EmptyState,
  Skeleton,
  Card,
  FormField,
  Select,
  Input,
  FilterChip,
  FilterChipRow,
  FilterToolbar,
} from '../components/ui';

const STATUSES = ['RECEIVED', 'PARSED', 'PARSE_ERROR', 'UNRECOGNIZED_FORMAT', 'DUPLICATE', 'FAILED'];
const SOURCES = ['upload', 'sftp', 'as2'] as const;

export interface IngestionsPageProps {
  /** N3 — suppress this page's PageHeader when rendered inside the
   *  Documents explorer (the parent already owns the title + toggle). */
  hideHeader?: boolean;
}

export function IngestionsPage({ hideHeader = false }: IngestionsPageProps = {}): JSX.Element {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const isOps = useHasRole('ops');
  const filters = {
    source: sp.get('source') ?? undefined,
    status: sp.get('status') ?? undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    limit: 50,
  };
  const ingestKey = useTenantQueryKey('ingest', filters);
  const ingestPrefix = useTenantQueryKey('ingest');
  const q = useQuery({ queryKey: ingestKey, queryFn: () => api.ingest(filters) });
  const reparseM = useMutation({
    mutationFn: (id: string) => api.reparseRaw(id),
    onSuccess: () => {
      toast.success('Re-parse queued');
      void qc.invalidateQueries({ queryKey: ingestPrefix });
    },
    onError: (err) => {
      toast.error('Re-parse failed', { description: err instanceof Error ? err.message : undefined });
    },
  });
  const items = q.data?.items ?? [];
  const preferMobileCards = usePreferMobileCards();

  function setFilter(key: string, value: string | undefined): void {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    setSp(next);
  }
  function clearAll(): void {
    setSp(new URLSearchParams());
  }

  const hasAnyFilter = Boolean(filters.source || filters.status || filters.from || filters.to);
  const secondaryFilterCount = [filters.source, filters.from, filters.to].filter(Boolean).length;

  return (
    <div>
      {hideHeader ? null : (
        <PageHeader
          title="Received Files"
          subtitle="Every raw EDI transmission received by the hub, newest first."
          actions={
            <span className="text-sm text-[var(--color-fg-muted)] tabular-nums">
              {q.isLoading ? (
                <Skeleton.Row width="5rem" height="h-4" className="inline-block" />
              ) : (
                `${items.length} shown`
              )}
            </span>
          }
        />
      )}

      <RequireRole role="ops">
        <IngestUploadPanel />
      </RequireRole>

      <Card className="container-panel mb-3">
        <div className="p-3">
          <FilterToolbar
            activeSecondaryCount={secondaryFilterCount}
            inline={
              <>
                <div className="flex flex-wrap gap-2 pb-1">
                  {(['PARSE_ERROR', 'FAILED', 'DUPLICATE'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="btn text-xs"
                      onClick={() => setFilter('status', filters.status === s ? undefined : s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <FormField label="Status">
                  <Select size="sm" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value || undefined)}>
                    <option value="">All</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </FormField>
              </>
            }
            secondary={
              <>
                <FormField label="Source">
                  <Select size="sm" value={filters.source ?? ''} onChange={(e) => setFilter('source', e.target.value || undefined)}>
                    <option value="">All</option>
                    {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </FormField>
                <FormField label="From">
                  <Input size="sm" type="date" value={filters.from ?? ''} onChange={(e) => setFilter('from', e.target.value || undefined)} />
                </FormField>
                <FormField label="To">
                  <Input size="sm" type="date" value={filters.to ?? ''} onChange={(e) => setFilter('to', e.target.value || undefined)} />
                </FormField>
              </>
            }
          />
        </div>
      </Card>

      <FilterChipRow onClearAll={hasAnyFilter ? clearAll : undefined}>
        {filters.source ? <FilterChip key="source" label="Source" value={filters.source} onRemove={() => setFilter('source', undefined)} /> : null}
        {filters.status ? <FilterChip key="status" label="Status" value={filters.status} onRemove={() => setFilter('status', undefined)} /> : null}
        {filters.from ? <FilterChip key="from" label="From" value={filters.from} onRemove={() => setFilter('from', undefined)} /> : null}
        {filters.to ? <FilterChip key="to" label="To" value={filters.to} onRemove={() => setFilter('to', undefined)} /> : null}
      </FilterChipRow>

      {q.isLoading ? (
        <Skeleton.List rows={6} columnWidths={['30%', '14%', '14%', '20%']} />
      ) : q.isError ? (
        <ErrorState
          title="Could not load received files"
          description="The API isn't responding. Make sure the server is running and try again."
          action={<button className="btn" onClick={() => q.refetch()}>Retry</button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={hasAnyFilter ? 'No received files match these filters' : 'No files received yet'}
          description={
            hasAnyFilter
              ? 'Try widening the filters above or clear them entirely.'
              : 'Drop an EDI file into the configured SFTP folder, use Upload above, or POST to /api/ingest/upload.'
          }
          action={hasAnyFilter ? <button className="btn" onClick={clearAll}>Clear filters</button> : null}
        />
      ) : (
        <>
        {preferMobileCards ? (
          <IngestionMobileCards
            items={items}
            isOps={isOps}
            onReparse={(id) => reparseM.mutate(id)}
          />
        ) : null}
        {preferMobileCards ? null : (
        <DataTable>
          <DataTable.Thead>
            <DataTable.Tr>
              <DataTable.Th title="Unique file ID assigned by the sender's system">ISA control # (File ID)</DataTable.Th>
              <DataTable.Th>Source</DataTable.Th>
              <DataTable.Th>Status</DataTable.Th>
              <DataTable.Th>Error</DataTable.Th>
              <DataTable.Th>Received</DataTable.Th>
              <DataTable.Th>Actions</DataTable.Th>
            </DataTable.Tr>
          </DataTable.Thead>
          <DataTable.Tbody>
            {items.map((r: RawFileRecord) => (
              <DataTable.Tr key={r.id}>
                <DataTable.Td mono>{r.isaControlNumber ?? '—'}</DataTable.Td>
                <DataTable.Td>
                  <StatusPill tone="neutral" size="sm">{r.source}</StatusPill>
                </DataTable.Td>
                <DataTable.Td>
                  <StatusPill tone={rawFileTone(r.status)} withDot>{r.status}</StatusPill>
                </DataTable.Td>
                <DataTable.Td muted className="max-w-xs">
                  <span className="truncate" title={r.errorMessage ?? undefined}>{r.errorMessage ?? '—'}</span>
                  {r.errorMessage ? (
                    <button
                      type="button"
                      className="ml-2 text-xs text-[var(--color-brand-600)] hover:underline"
                      data-testid={`copy-parse-context-${r.id}`}
                      onClick={() => void navigator.clipboard.writeText(buildParseErrorReport(r))}
                    >
                      Copy report
                    </button>
                  ) : null}
                </DataTable.Td>
                <DataTable.Td muted>{new Date(r.ingestedAt).toLocaleString()}</DataTable.Td>
                <DataTable.Td>
                  <button
                    type="button"
                    className="text-sm text-[var(--color-brand-600)] hover:underline"
                    onClick={() => void api.rawContent(r.id).then((t) => {
                      const blob = new Blob([t], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const opened = window.open(url, '_blank');
                      if (!opened) URL.revokeObjectURL(url);
                      else setTimeout(() => URL.revokeObjectURL(url), 60_000);
                    })}
                  >
                    Raw
                  </button>
                  {isOps && (r.status === 'PARSE_ERROR' || r.status === 'FAILED' || r.status === 'RECEIVED') ? (
                    <button
                      type="button"
                      className="ml-2 text-sm text-[var(--color-brand-600)] hover:underline"
                      data-testid={`reparse-${r.id}`}
                      onClick={() => reparseM.mutate(r.id)}
                    >
                      Retry parse
                    </button>
                  ) : null}
                </DataTable.Td>
              </DataTable.Tr>
            ))}
          </DataTable.Tbody>
        </DataTable>
        )}
        </>
      )}
    </div>
  );
}
