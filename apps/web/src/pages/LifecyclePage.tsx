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
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type {
  LifecycleDirection,
  LifecycleEvent,
  LifecycleResponse,
  LifecycleStatus,
  RejectionSegmentError,
} from '@edi/shared';
import { api, type LifecycleKey } from '../lib/api.ts';
import { LifecycleRawPanel } from '../components/LifecycleRawPanel.tsx';
import {
  PageHeader,
  StatusPill,
  type StatusTone,
  Card,
  ErrorState,
  EmptyState,
  Skeleton,
} from '../components/ui';
import { OutboundLifecycleBadges } from '../components/OutboundStage.tsx';

const STATUS_LABEL: Record<LifecycleStatus, string> = {
  received: 'Received',
  acknowledged: 'Acknowledged',
  rejected: 'Rejected',
  expected_missing: 'Expected — not received',
};
const STATUS_TONE: Record<LifecycleStatus, StatusTone> = {
  received: 'neutral',
  acknowledged: 'success',
  rejected: 'error',
  expected_missing: 'warn',
};

const DIRECTION_LABEL: Record<LifecycleDirection, string> = {
  inbound: 'Inbound',
  outbound: 'Outbound',
  unknown: 'Unknown',
};
const DIRECTION_TONE: Record<LifecycleDirection, StatusTone> = {
  inbound: 'info',
  outbound: 'brand',
  unknown: 'neutral',
};

const FLOW_LABEL: Record<LifecycleResponse['flow'], string> = {
  standard: 'Standard PO flow',
  grocery: 'Grocery PO flow',
  unknown: 'Custom / unknown flow',
};

/** Dot color tracks the event status — same tone scale as the StatusPill. */
const DOT_COLOR: Record<LifecycleStatus, string> = {
  received:         'bg-[var(--color-info-500)] ring-[var(--color-info-500)]/30',
  acknowledged:     'bg-[var(--color-success-500)] ring-[var(--color-success-500)]/30',
  rejected:         'bg-[var(--color-error-500)] ring-[var(--color-error-500)]/30',
  expected_missing: 'bg-transparent ring-[var(--color-warn-500)] border-2 border-dashed border-[var(--color-warn-500)]',
};

export function LifecyclePage(): JSX.Element {
  const { po: poParam = '' } = useParams();
  const [sp] = useSearchParams();
  const invoice = sp.get('invoice') ?? undefined;
  const shipment = sp.get('shipment') ?? undefined;

  const key: LifecycleKey = invoice ? 'invoice' : shipment ? 'shipment' : 'po';
  const value = invoice ?? shipment ?? poParam;

  const q = useQuery({
    queryKey: ['lifecycle', key, value],
    queryFn: () => api.lifecycle(key, value),
    enabled: value.length > 0,
    // Desktop drop-folder workflow: new files can land while this page is open.
    // Always refetch on mount and poll so gaps clear without a manual refresh.
    refetchOnMount: 'always',
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-6">
      {/* Back link + PageHeader with prominent PO + entry metadata + Print action */}
      <div className="print:hidden">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Transactions
        </Link>
      </div>
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
            <button type="button" className="btn print:hidden" onClick={() => window.print()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              Print
            </button>
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
        <Timeline events={q.data.events} po={q.data.po} />
      )}
    </div>
  );
}

function Timeline({ events, po }: { events: LifecycleEvent[]; po: string }): JSX.Element {
  if (events.length === 0) {
    return <EmptyState title={`No documents found for PO ${po}`} />;
  }

  const duplicateTotals = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 'transaction') continue;
    const k = `${e.transactionSetId}::${e.direction}`;
    duplicateTotals.set(k, (duplicateTotals.get(k) ?? 0) + 1);
  }

  return (
    <ol className="relative">
      {events.map((e, i) => {
        const dupKey = e.kind === 'transaction' ? `${e.transactionSetId}::${e.direction}` : '';
        const duplicateTotal = dupKey ? (duplicateTotals.get(dupKey) ?? 1) : 1;
        return (
          <TimelineRow
            key={`${e.transactionId ?? 'gap'}-${i}`}
            event={e}
            isLast={i === events.length - 1}
            duplicateTotal={duplicateTotal}
          />
        );
      })}
    </ol>
  );
}

function TimelineRow({ event, isLast, duplicateTotal }: { event: LifecycleEvent; isLast: boolean; duplicateTotal: number }): JSX.Element {
  const isGap = event.kind === 'gap';
  const showRejection = event.status === 'rejected' && (event.rejectionSummary || event.rejectionDetails);
  const [rawOpen, setRawOpen] = useState(false);
  const showDuplicateBadge = duplicateTotal > 1 && event.instanceIndex !== null;
  return (
    <li
      className="relative flex gap-4 pb-3 last:pb-0"
      data-kind={event.kind}
    >
      {/* Left rail: connector line + status dot */}
      <div className="relative flex w-6 shrink-0 justify-center">
        {!isLast ? (
          <span
            aria-hidden
            className="absolute left-1/2 top-3 h-full -translate-x-1/2 border-l border-dashed border-[var(--color-surface-border)]"
          />
        ) : null}
        <span
          aria-hidden
          className={`relative z-10 mt-2 h-3 w-3 rounded-full ring-4 ring-[var(--color-surface-bg)] ${DOT_COLOR[event.status]}`}
        />
      </div>

      {/* Right: the event content card */}
      <div className="flex-1">
        <Card
          className={`${
            isGap
              ? 'border-dashed border-[var(--color-warn-500)]/40 bg-[var(--color-warn-50)]/40'
              : ''
          }`}
        >
          <Card.Content className="space-y-2 !p-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* Set badge — big, mono, prominent */}
              <span
                className={`inline-block min-w-[3rem] rounded-md px-2 py-0.5 text-center font-mono text-sm font-semibold ${
                  isGap
                    ? 'bg-[var(--color-warn-500)]/15 text-[var(--color-warn-700)]'
                    : 'bg-[var(--color-surface-muted)] text-[var(--color-fg)]'
                }`}
              >
                {event.transactionSetId}
              </span>

              {showDuplicateBadge ? (
                <span
                  data-testid="duplicate-badge"
                  className="inline-flex items-center rounded-full bg-[var(--color-brand-50)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-brand-700)]"
                >
                  {event.transactionSetId} · {event.instanceIndex} of {duplicateTotal}
                </span>
              ) : null}

              <StatusPill tone={DIRECTION_TONE[event.direction]} size="sm">
                {DIRECTION_LABEL[event.direction]}
              </StatusPill>

              {event.direction === 'outbound' && event.kind === 'transaction' && event.outboundStage ? (
                <OutboundLifecycleBadges stage={event.outboundStage} status={event.status} />
              ) : (
                <StatusPill tone={STATUS_TONE[event.status]} size="sm" withDot>
                  {STATUS_LABEL[event.status]}
                </StatusPill>
              )}

              {/* Phase 8 Sprint 3 — partner transmission channel chip. Intentionally
                  subtle — "via X" reads as metadata, not status. */}
              {event.partnerChannel ? (
                <span
                  data-testid={`partner-channel-${event.partnerChannel}`}
                  className="inline-flex items-center rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-fg-muted)]"
                >
                  via {event.partnerChannel}
                </span>
              ) : null}

              <span className="text-xs text-[var(--color-fg-muted)] tabular-nums">
                {event.ingestedAt ? new Date(event.ingestedAt).toLocaleString() : '—'}
              </span>

              {event.controlNumber ? (
                <span className="ml-auto font-mono text-[11px] text-[var(--color-fg-subtle)]">
                  ctrl <span className="text-[var(--color-fg-muted)]">{event.controlNumber}</span>
                  {event.isaControlNumber ? (
                    <>
                      {' '}· isa <span className="text-[var(--color-fg-muted)]">{event.isaControlNumber}</span>
                    </>
                  ) : null}
                  {event.source ? (
                    <>
                      {' '}· <span className="text-[var(--color-fg-muted)]">{event.source}</span>
                    </>
                  ) : null}
                  {event.ackStatus ? (
                    <>
                      {' '}· ak9 <span className="text-[var(--color-fg-muted)]">{event.ackStatus}</span>
                    </>
                  ) : null}
                </span>
              ) : (
                <span className="ml-auto text-xs italic text-[var(--color-warn-700)]">
                  expected — not received
                </span>
              )}

              {event.kind === 'transaction' && event.transactionId ? (
                <span className="flex items-center gap-2 print:hidden">
                  {event.rawFileId ? (
                    <button
                      type="button"
                      data-testid="expand-raw"
                      onClick={() => setRawOpen((v) => !v)}
                      className="text-sm text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
                    >
                      {rawOpen ? 'Hide raw' : 'Expand raw'}
                    </button>
                  ) : null}
                  <Link
                    to={`/transactions/${event.transactionId}`}
                    className="text-sm text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
                  >
                    Full detail
                  </Link>
                </span>
              ) : null}
            </div>

            {rawOpen && event.rawFileId ? (
              <LifecycleRawPanel rawFileId={event.rawFileId} />
            ) : null}

            {/* Rejection panel — summary + expandable AK error tree */}
            {showRejection ? (
              <RejectionPanel
                summary={event.rejectionSummary ?? null}
                details={event.rejectionDetails ?? null}
                fullDetailHref={event.kind === 'transaction' && event.transactionId ? `/transactions/${event.transactionId}` : null}
              />
            ) : null}
          </Card.Content>
        </Card>
      </div>
    </li>
  );
}

/** Inline rejection panel — summary banner always visible; full AK tree
 *  collapsed by default to keep the timeline scannable. */
function RejectionPanel({
  summary,
  details,
  fullDetailHref,
}: {
  summary: string | null;
  // `event.rejectionDetails` is `RejectionSegmentError[] | null` — one entry
  // per AK3 (segment-level error). The earlier annotation incorrectly named
  // this `TransactionRejection[]`, which is the outer wrapper attached to
  // a 997-rejected transaction's detail response, not a list shape.
  details: RejectionSegmentError[] | null;
  fullDetailHref: string | null;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const hasTree = Array.isArray(details) && details.length > 0;
  return (
    <div
      data-testid="rejection-summary"
      className="rounded-md border border-[var(--color-error-500)]/30 bg-[var(--color-error-50)] px-3 py-2 text-xs text-[var(--color-error-700)]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold uppercase tracking-wide text-[10px]">Rejected</span>
        <span>{summary ?? 'see transaction detail'}</span>
        {hasTree ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-error-700)] hover:bg-[var(--color-error-500)]/10 print:hidden"
            aria-expanded={open}
          >
            {open ? 'Hide details' : `Show ${details.length} error${details.length === 1 ? '' : 's'}`}
          </button>
        ) : null}
        {fullDetailHref ? (
          <Link
            to={fullDetailHref}
            className="text-[var(--color-error-700)] underline decoration-[var(--color-error-500)]/40 underline-offset-2 hover:decoration-[var(--color-error-500)]"
          >
            Full detail →
          </Link>
        ) : null}
      </div>

      {open && hasTree ? (
        <ul className="mt-2 space-y-2 border-t border-[var(--color-error-500)]/20 pt-2">
          {details.map((d, i) => (
            <li key={i} className="space-y-1">
              <div className="font-mono text-[11px]">
                <span className="font-semibold">{d.segmentTag}</span>
                {d.segmentPosition ? <> · pos {d.segmentPosition}</> : null}
                {d.loopIdentifier ? <> · loop {d.loopIdentifier}</> : null}
                {d.syntaxErrorCode ? (
                  <> · code {d.syntaxErrorCode}</>
                ) : null}
              </div>
              {d.syntaxErrorMessage ? (
                <div className="text-[var(--color-error-700)]/90">{d.syntaxErrorMessage}</div>
              ) : null}
              {Array.isArray(d.elementErrors) && d.elementErrors.length > 0 ? (
                <ul className="ml-4 list-disc space-y-0.5 text-[var(--color-error-700)]/85">
                  {d.elementErrors.map((e, j) => (
                    <li key={j}>
                      <span className="font-mono">
                        elem {e.elementPosition}
                        {e.dataElementReference ? ` (${e.dataElementReference})` : ''}
                      </span>
                      {e.syntaxErrorMessage ? <>: {e.syntaxErrorMessage}</> : null}
                      {e.badValue ? (
                        <> — bad value <span className="font-mono">{e.badValue}</span></>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
