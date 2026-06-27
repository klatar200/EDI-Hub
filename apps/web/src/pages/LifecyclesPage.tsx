/**
 * PS-1 — Lifecycle-first homepage.
 *
 * PO/conversation list with row summaries: partner, flow, status counts,
 * alert badge, parse-error rollup. Row expand stub loads timeline on expand
 * (full expand-in-place ships in PS-2).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { LifecycleFlow, LifecycleSummary } from '@edi/shared';
import { api } from '../lib/api.ts';
import {
  PageHeader,
  DataTable,
  StatusPill,
  Pagination,
  ErrorState,
  EmptyState,
  Skeleton,
} from '../components/ui';

const PAGE_SIZE = 25;

const FLOW_LABEL: Record<LifecycleFlow, string> = {
  standard: 'Standard',
  grocery: 'Grocery',
  unknown: 'Custom',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function LifecycleRow({ row }: { row: LifecycleSummary }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const expandQ = useQuery({
    queryKey: ['lifecycle', row.po],
    queryFn: () => api.lifecycle('po', row.po),
    enabled: expanded,
  });

  return (
    <>
      <DataTable.Tr data-testid={`lifecycle-row-${row.po}`}>
        <DataTable.Td>
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
        <DataTable.Td>
          <span className="tabular-nums">{row.received}</span>
          {row.missing > 0 ? (
            <span className="ml-1.5 inline-block"><StatusPill tone="warn" size="sm">{row.missing} missing</StatusPill></span>
          ) : null}
          {row.rejected > 0 ? (
            <span className="ml-1.5 inline-block"><StatusPill tone="error" size="sm">{row.rejected} rejected</StatusPill></span>
          ) : null}
        </DataTable.Td>
        <DataTable.Td>
          {row.openAlertCount > 0 ? (
            <Link to={`/alerts`} data-testid={`alert-badge-${row.po}`}>
              <StatusPill tone="error" size="sm" withDot>{row.openAlertCount}</StatusPill>
            </Link>
          ) : (
            <span className="text-[var(--color-fg-subtle)]">—</span>
          )}
        </DataTable.Td>
        <DataTable.Td>
          {row.hasParseError ? (
            <Link
              to="/ingestions?status=PARSE_ERROR"
              data-testid={`parse-error-badge-${row.po}`}
            >
              <StatusPill tone="warn" size="sm" withDot>Parse error</StatusPill>
            </Link>
          ) : row.hasDuplicates ? (
            <StatusPill tone="info" size="sm">
              +{row.additionalDocumentCount} extra
            </StatusPill>
          ) : (
            <span className="text-[var(--color-fg-subtle)]">—</span>
          )}
        </DataTable.Td>
      </DataTable.Tr>
      {expanded ? (
        <DataTable.Tr>
          <DataTable.Td colSpan={8} className="bg-[var(--color-surface-muted)]/40">
            {expandQ.isLoading ? (
              <p className="py-3 text-sm text-[var(--color-fg-muted)]">Loading timeline…</p>
            ) : expandQ.isError || !expandQ.data ? (
              <p className="py-3 text-sm text-[var(--color-fg-muted)]">Could not load timeline.</p>
            ) : (
              <div className="py-2" data-testid={`expand-panel-${row.po}`}>
                <p className="mb-2 text-sm text-[var(--color-fg-muted)]">
                  {expandQ.data.events.length} events —{' '}
                  <Link
                    to={`/lifecycle/${encodeURIComponent(row.po)}`}
                    className="text-[var(--color-brand-600)] hover:underline"
                  >
                    Open full view
                  </Link>
                </p>
                <ul className="space-y-1 text-sm">
                  {expandQ.data.events.map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="font-mono text-[var(--color-fg-muted)]">{e.transactionSetId}</span>
                      <StatusPill tone={e.status === 'expected_missing' ? 'warn' : 'neutral'} size="sm">
                        {e.status.replace('_', ' ')}
                      </StatusPill>
                    </li>
                  ))}
                </ul>
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
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);

  const listQ = useQuery({
    queryKey: ['lifecycles', page],
    queryFn: () => api.lifecycles({ page, pageSize: PAGE_SIZE }),
  });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;

  function setPage(p: number): void {
    const next = new URLSearchParams(sp);
    if (p > 1) next.set('page', String(p));
    else next.delete('page');
    setSp(next);
  }

  return (
    <div>
      <PageHeader
        title="Lifecycles"
        subtitle="PO conversations — every related document in one place."
        actions={
          <span className="text-sm text-[var(--color-fg-muted)] tabular-nums">
            {listQ.isLoading ? 'Loading…' : `${total} conversation${total === 1 ? '' : 's'}`}
          </span>
        }
      />

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
          title="No PO conversations yet"
          description="Once partners send EDI through the configured channels, PO lifecycles will appear here."
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
                <DataTable.Th>Documents</DataTable.Th>
                <DataTable.Th>Alerts</DataTable.Th>
                <DataTable.Th>Flags</DataTable.Th>
              </DataTable.Tr>
            </DataTable.Thead>
            <DataTable.Tbody>
              {items.map((row) => (
                <LifecycleRow key={row.po} row={row} />
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
