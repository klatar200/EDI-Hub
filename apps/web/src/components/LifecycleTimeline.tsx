/**
 * Shared lifecycle vertical timeline — used by LifecyclePage and
 * LifecyclesPage expand-in-place (PS-2).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  LifecycleDirection,
  LifecycleEvent,
  LifecycleStatus,
  RejectionSegmentError,
} from '@edi/shared';
import { api } from '../lib/api.ts';
import { LifecycleRawPanel } from './LifecycleRawPanel.tsx';
import { DuplicateComparePanel } from './DuplicateComparePanel.tsx';
import { StatusPill, type StatusTone, Card, EmptyState } from './ui';
import { OutboundLifecycleBadges } from './OutboundStage.tsx';

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

const DOT_COLOR: Record<LifecycleStatus, string> = {
  received:         'bg-[var(--color-info-500)] ring-[var(--color-info-500)]/30',
  acknowledged:     'bg-[var(--color-success-500)] ring-[var(--color-success-500)]/30',
  rejected:         'bg-[var(--color-error-500)] ring-[var(--color-error-500)]/30',
  expected_missing: 'bg-transparent ring-[var(--color-warn-500)] border-2 border-dashed border-[var(--color-warn-500)]',
};

export interface LifecycleTimelineProps {
  events: LifecycleEvent[];
  po: string;
  /** PS-2 — show per-transaction raw download button. */
  showDownloadRaw?: boolean;
  compact?: boolean;
}

export function LifecycleTimeline({ events, po, showDownloadRaw = false, compact = false }: LifecycleTimelineProps): JSX.Element {
  if (events.length === 0) {
    return <EmptyState title={`No documents found for PO ${po}`} />;
  }

  const duplicateTotals = new Map<string, number>();
  const duplicateGroups = new Map<string, LifecycleEvent[]>();
  for (const e of events) {
    if (e.kind !== 'transaction') continue;
    const k = `${e.transactionSetId}::${e.direction}`;
    duplicateTotals.set(k, (duplicateTotals.get(k) ?? 0) + 1);
    const list = duplicateGroups.get(k) ?? [];
    list.push(e);
    duplicateGroups.set(k, list);
  }
  const compareGroups = [...duplicateGroups.entries()].filter(([, g]) => g.length > 1);

  return (
    <div>
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
            showDownloadRaw={showDownloadRaw}
            compact={compact}
          />
        );
      })}
    </ol>
    {compareGroups.length > 0 ? (
      <div className="mt-4 space-y-3" data-testid="duplicate-compare-section">
        {compareGroups.map(([key, groupEvents]) => {
          const [setId, direction] = key.split('::') as [string, LifecycleEvent['direction']];
          return (
            <DuplicateComparePanel
              key={key}
              setId={setId}
              direction={direction}
              events={groupEvents}
            />
          );
        })}
      </div>
    ) : null}
    </div>
  );
}

function TimelineRow({
  event,
  isLast,
  duplicateTotal,
  showDownloadRaw,
  compact,
}: {
  event: LifecycleEvent;
  isLast: boolean;
  duplicateTotal: number;
  showDownloadRaw: boolean;
  compact: boolean;
}): JSX.Element {
  const isGap = event.kind === 'gap';
  const showRejection = event.status === 'rejected' && (event.rejectionSummary || event.rejectionDetails);
  const [rawOpen, setRawOpen] = useState(false);
  const showDuplicateBadge = duplicateTotal > 1 && event.instanceIndex !== null;

  async function downloadRaw(): Promise<void> {
    if (!event.rawFileId) return;
    await api.downloadRawFile(event.rawFileId, `${event.transactionSetId}-${event.controlNumber ?? event.rawFileId}.edi`);
  }

  return (
    <li className="relative flex gap-4 pb-3 last:pb-0" data-kind={event.kind}>
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

      <div className="flex-1">
        <Card
          className={`${
            isGap
              ? 'border-dashed border-[var(--color-warn-500)]/40 bg-[var(--color-warn-50)]/40'
              : ''
          }`}
        >
          <Card.Content className={`space-y-2 ${compact ? '!p-2' : '!p-3'}`}>
            <div className="flex flex-wrap items-center gap-2">
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
                </span>
              ) : (
                <span className="ml-auto text-xs italic text-[var(--color-warn-700)]">
                  expected — not received
                </span>
              )}

              {event.kind === 'transaction' && event.transactionId ? (
                <span className="flex items-center gap-2 print:hidden">
                  {showDownloadRaw && event.rawFileId ? (
                    <button
                      type="button"
                      data-testid="download-raw"
                      onClick={() => void downloadRaw()}
                      className="text-sm text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
                    >
                      Download raw
                    </button>
                  ) : null}
                  {!compact && event.rawFileId ? (
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

function RejectionPanel({
  summary,
  details,
  fullDetailHref,
}: {
  summary: string | null;
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
            {open ? 'Hide details' : `Show ${details!.length} error${details!.length === 1 ? '' : 's'}`}
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
          {details!.map((d, i) => (
            <li key={i} className="space-y-1">
              <div className="font-mono text-[11px]">
                <span className="font-semibold">{d.segmentTag}</span>
                {d.segmentPosition ? <> · pos {d.segmentPosition}</> : null}
              </div>
              {d.syntaxErrorMessage ? (
                <div className="text-[var(--color-error-700)]/90">{d.syntaxErrorMessage}</div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
