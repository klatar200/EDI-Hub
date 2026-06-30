/**
 * U5/AC2 — card-view fallback for dense tables below the `md` breakpoint.
 */
import { Link } from 'react-router-dom';
import type { LifecycleSummary, RawFileRecord, TransactionSummary } from '@edi/shared';
import { api } from '../lib/api.ts';
import { Card, StatusPill, rawFileTone } from './ui';
import { EdiTerm } from './EdiTerm.tsx';

const DIRECTION_LABEL: Record<string, string> = {
  inbound: 'Inbound',
  outbound: 'Outbound',
  unknown: 'Unknown',
};

export function LifecycleMobileCards({ items }: { items: LifecycleSummary[] }): JSX.Element {
  return (
    <ul className="space-y-2 md:hidden" data-testid="lifecycle-mobile-cards">
      {items.map((row) => (
        <li key={row.po}>
          <Card className="p-3">
            <div className="flex items-start justify-between gap-2">
              <Link
                to={`/lifecycle/${encodeURIComponent(row.po)}`}
                className="font-medium text-[var(--color-fg)] underline decoration-[var(--color-surface-border)] underline-offset-2"
              >
                {row.po}
              </Link>
              {row.openAlertCount > 0 ? (
                <StatusPill tone="error" size="sm" withDot>{row.openAlertCount}</StatusPill>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{row.partnerDisplayName ?? '—'}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--color-fg-muted)]">
              <span>{row.received} docs</span>
              {row.missing > 0 ? <span className="text-[var(--color-warn-700)]">{row.missing} missing</span> : null}
              {row.hasParseError ? <span className="text-[var(--color-warn-700)]">Parse error</span> : null}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function TransactionMobileCards({ items }: { items: TransactionSummary[] }): JSX.Element {
  return (
    <ul className="space-y-2 md:hidden" data-testid="transaction-mobile-cards">
      {items.map((t) => (
        <li key={t.id}>
          <Card className="p-3">
            <div className="flex items-center justify-between gap-2">
              <EdiTerm term={t.transactionSetId} className="font-mono text-sm font-semibold" />
              {t.status ? (
                <StatusPill tone={rawFileTone(t.status)} size="sm" withDot>{t.status}</StatusPill>
              ) : null}
            </div>
            <Link
              to={`/transactions/${t.id}`}
              className="mt-1 block text-sm font-medium text-[var(--color-fg)] underline decoration-[var(--color-surface-border)] underline-offset-2"
            >
              {t.poNumber ?? t.invoiceNumber ?? t.controlNumber}
            </Link>
            <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
              {DIRECTION_LABEL[t.direction] ?? t.direction}
              {' · '}
              {t.senderId ?? '—'} → {t.receiverId ?? '—'}
            </p>
            {t.ingestedAt ? (
              <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                {new Date(t.ingestedAt).toLocaleString()}
              </p>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function IngestionMobileCards({
  items,
  isOps,
  onReparse,
}: {
  items: RawFileRecord[];
  isOps: boolean;
  onReparse: (id: string) => void;
}): JSX.Element {
  return (
    <ul className="space-y-2 md:hidden" data-testid="ingestion-mobile-cards">
      {items.map((r) => (
        <li key={r.id}>
          <Card className="p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm">{r.isaControlNumber ?? '—'}</span>
              <StatusPill tone={rawFileTone(r.status)} size="sm" withDot>{r.status}</StatusPill>
            </div>
            <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
              {r.source}
              {' · '}
              {new Date(r.ingestedAt).toLocaleString()}
            </p>
            {r.errorMessage ? (
              <p className="mt-1 truncate text-xs text-[var(--color-error-700)]" title={r.errorMessage}>
                {r.errorMessage}
              </p>
            ) : null}
            <div className="mt-2 flex gap-3">
              <button
                type="button"
                aria-label={`View raw file ${r.isaControlNumber ?? r.id}`}
                className="text-xs text-[var(--color-brand-600)] hover:underline"
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
                  aria-label={`Retry parse for ${r.isaControlNumber ?? r.id}`}
                  className="text-xs text-[var(--color-brand-600)] hover:underline"
                  data-testid={`reparse-mobile-${r.id}`}
                  onClick={() => onReparse(r.id)}
                >
                  Retry parse
                </button>
              ) : null}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
