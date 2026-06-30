/**
 * UR5/R33 — lifecycle detail metadata column at 2xl+.
 */
import { Link } from 'react-router-dom';
import type { LifecycleEvent, LifecycleResponse } from '@edi/shared';
import { Card } from './ui';

const FLOW_LABEL: Record<LifecycleResponse['flow'], string> = {
  standard: 'Standard PO flow',
  grocery: 'Grocery PO flow',
  unknown: 'Custom / unknown flow',
};

function formatDueDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  const y = yyyymmdd.slice(0, 4);
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  return `${y}-${m}-${d}`;
}

function summarizeEvents(events: LifecycleEvent[]): {
  documents: number;
  gaps: number;
  rejected: number;
  acknowledged: number;
} {
  let documents = 0;
  let gaps = 0;
  let rejected = 0;
  let acknowledged = 0;
  for (const e of events) {
    if (e.kind === 'gap') {
      gaps += 1;
      continue;
    }
    documents += 1;
    if (e.status === 'rejected') rejected += 1;
    if (e.status === 'acknowledged') acknowledged += 1;
  }
  return { documents, gaps, rejected, acknowledged };
}

export function LifecycleSummaryPanel({ data }: { data: LifecycleResponse }): JSX.Element {
  const stats = summarizeEvents(data.events);
  const partner = data.partner;

  return (
    <aside className="space-y-4" data-testid="lifecycle-summary-panel">
      <Card>
        <Card.Content className="!p-4 space-y-3 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
            Conversation
          </h2>
          <dl className="space-y-2">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)]">PO</dt>
              <dd className="font-mono text-[var(--color-fg)]">{data.po}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)]">Entered by</dt>
              <dd className="font-mono text-[var(--color-fg)]">
                {data.enteredBy.value}
                {data.enteredBy.kind !== 'po' ? ` (${data.enteredBy.kind})` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)]">Flow</dt>
              <dd>{FLOW_LABEL[data.flow]}</dd>
            </div>
            {data.dueDate ? (
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)]">Due date</dt>
                <dd className="font-mono">{formatDueDate(data.dueDate)}</dd>
              </div>
            ) : null}
          </dl>
        </Card.Content>
      </Card>

      {partner ? (
        <Card>
          <Card.Content className="!p-4 space-y-2 text-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">Partner</h2>
            <p className="font-medium text-[var(--color-fg)]">{partner.displayName}</p>
            <Link
              to="/partners-config"
              className="text-xs text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
            >
              Open partner config →
            </Link>
            {partner.slaWindows.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-[var(--color-fg-muted)]">
                {partner.slaWindows.slice(0, 4).map((w) => (
                  <li key={`${w.setId}-${w.direction}`}>
                    {w.setId} {w.direction}: {w.withinMinutes >= 60 ? `${Math.round(w.withinMinutes / 60)}h` : `${w.withinMinutes}m`} SLA
                  </li>
                ))}
              </ul>
            ) : null}
          </Card.Content>
        </Card>
      ) : null}

      <Card>
        <Card.Content className="!p-4 space-y-2 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">Timeline</h2>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <dt className="text-[var(--color-fg-subtle)]">Documents</dt>
              <dd className="font-mono font-semibold tabular-nums">{stats.documents}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-fg-subtle)]">With 997 ack</dt>
              <dd className="font-mono font-semibold tabular-nums">{stats.acknowledged}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-fg-subtle)]">Missing</dt>
              <dd className="font-mono font-semibold tabular-nums text-[var(--color-warn-700)]">{stats.gaps}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-fg-subtle)]">Rejected</dt>
              <dd className="font-mono font-semibold tabular-nums text-[var(--color-error-700)]">{stats.rejected}</dd>
            </div>
          </dl>
          {data.linkedPos.length > 0 ? (
            <p className="pt-1 text-xs text-[var(--color-fg-muted)]">
              {data.linkedPos.length} linked PO{data.linkedPos.length === 1 ? '' : 's'} on this invoice
            </p>
          ) : null}
        </Card.Content>
      </Card>
    </aside>
  );
}
