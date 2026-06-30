/**
 * UI Phase Sprint 3 — Lifecycle viewer (the North Star).
 *
 * Real vertical timeline: a status-colored dot rail on the left,
 * connector line down the middle, content cards on the right. Each
 * event shows set badge + direction + status pill + partner channel +
 * outbound stage + timestamp at a glance.
 *
 * Gap rows (expected-but-missing) get a hollow dashed dot, dashed
 * card border, amber tint, and an "expected — not received" tag.
 *
 * Rejected events render an inline rejection panel with an expandable
 * AK error tree (segment + element errors with codes + bad values).
 *
 * Print: the page is print-friendly — `@media print` rules in
 * index.css strip the nav + theme toggle + interactive controls.
 *
 * Functionally identical to the previous page — same data shape,
 * same URL search-param model, same test-id contract.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { LifecycleResponse } from '@edi/shared';

const FLOW_LABEL: Record<LifecycleResponse['flow'], string> = {
  standard: 'Standard PO flow',
  grocery: 'Grocery PO flow',
  unknown: 'Custom / unknown flow',
};
import { api, type LifecycleKey } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { LifecycleTimeline } from '../components/LifecycleTimeline.tsx';
import { LifecycleExportMenu } from '../components/LifecycleExportMenu.tsx';
import {
  PageHeader,
  ErrorState,
  EmptyState,
  Skeleton,
  Breadcrumbs,
} from '../components/ui';

export function LifecyclePage(): JSX.Element {
  const { po: poParam = '' } = useParams();
  const [sp] = useSearchParams();
  const invoice = sp.get('invoice') ?? undefined;
  const shipment = sp.get('shipment') ?? undefined;

  const key: LifecycleKey = invoice ? 'invoice' : shipment ? 'shipment' : 'po';
  const value = invoice ?? shipment ?? poParam;

  const lifecycleKey = useTenantQueryKey('lifecycle', key, value);
  const q = useQuery({
    queryKey: lifecycleKey,
    queryFn: () => api.lifecycle(key, value),
    enabled: value.length > 0,
    // Desktop drop-folder workflow: new files can land while this page is open.
    // Always refetch on mount and poll so gaps clear without a manual refresh.
    refetchOnMount: 'always',
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-6">
      {/* N5 — breadcrumb gives the page an explicit "up" path. The
          PageHeader title still carries the styled "Lifecycle · <id>"
          treatment, so the breadcrumb stays compact (parent + identifier). */}
      <Breadcrumbs
        className="print:hidden"
        items={[
          { to: '/lifecycles', label: 'Lifecycles', testId: 'breadcrumb-lifecycles' },
          { label: <span className="font-mono">{value}</span>, testId: 'breadcrumb-current' },
        ]}
      />
      <PageHeader
        title={
          <span className="flex items-baseline gap-2">
            <span className="text-[var(--color-fg-muted)]">Lifecycle</span>
            <span className="text-[var(--color-fg-subtle)]">·</span>
            <span className="font-mono">{value}</span>
          </span>
        }
        subtitle={
          q.data ? (
            <span>
              Entered by <span className="font-mono text-[var(--color-fg)]">{q.data.enteredBy.value}</span>
              {q.data.enteredBy.kind !== 'po' ? ` (${q.data.enteredBy.kind})` : ''}
              {' · '}
              <span className="text-[var(--color-fg)]">{FLOW_LABEL[q.data.flow]}</span>
            </span>
          ) : null
        }
        actions={
          q.data ? (
            <div className="flex flex-wrap items-center gap-3 print:hidden">
              <LifecycleExportMenu po={q.data.po} />
              <button type="button" className="btn" onClick={() => window.print()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              Print
            </button>
            </div>
          ) : null
        }
      />

      {q.isLoading ? (
        <Skeleton.Table rows={4} columnWidths={['100%']} />
      ) : q.isError ? (
        <ErrorState
          title="Could not load the lifecycle"
          description="The API isn't responding. Make sure the server is running and try again."
          action={<button className="btn" onClick={() => q.refetch()}>Retry</button>}
        />
      ) : !q.data ? (
        <EmptyState
          title="No PO matched this query"
          description={
            <>
              Try a different identifier from{' '}
              <Link to="/search" className="text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]">
                search
              </Link>
              .
            </>
          }
        />
      ) : (
        <>
          {q.data.linkedPos.length > 0 ? (
            <div
              className="rounded-md border border-[var(--color-brand-500)]/30 bg-[var(--color-brand-50)]/50 px-4 py-3 text-sm text-[var(--color-fg)]"
              data-testid="linked-pos-banner"
            >
              Invoice <span className="font-mono">{q.data.enteredBy.value}</span> also references:{' '}
              {q.data.linkedPos.map((linkedPo, i) => (
                <span key={linkedPo}>
                  {i > 0 ? ', ' : ''}
                  <Link
                    to={`/lifecycle/${encodeURIComponent(linkedPo)}?invoice=${encodeURIComponent(q.data!.enteredBy.value)}`}
                    className="font-mono text-[var(--color-brand-600)] hover:underline"
                  >
                    {linkedPo}
                  </Link>
                </span>
              ))}
            </div>
          ) : null}
          <LifecycleTimeline events={q.data.events} po={q.data.po} showDownloadRaw />
        </>
      )}
    </div>
  );
}
