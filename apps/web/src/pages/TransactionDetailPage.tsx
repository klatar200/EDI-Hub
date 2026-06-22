import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type { InterpretedTransaction, LineItem } from '@edi/edi-parser';
import { api, type TransactionDetail } from '../lib/api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { RawParsedView } from '../components/RawParsedView.tsx';
import { StageBadge, StageTimeline } from '../components/OutboundStage.tsx';

export function TransactionDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['transaction', id], queryFn: () => api.transaction(id) });

  if (q.isLoading) return <p className="text-sm text-[var(--color-fg-muted)]">Loading…</p>;
  if (q.isError || !q.data) {
    return (
      <div className="rounded-lg border border-[var(--color-error-500)]/30 bg-[var(--color-error-50)] p-6 text-sm text-[var(--color-error-700)]">
        Could not load this transaction.{' '}
        <Link className="underline" to="/">Back to list</Link>
      </div>
    );
  }
  const t = q.data;
  const header = headerFields(t.interpreted);
  const lineItems = 'lineItems' in t.interpreted ? t.interpreted.lineItems : [];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Transactions
          </Link>
          {t.poNumber ? (
            <Link
              to={`/lifecycle/${encodeURIComponent(t.poNumber)}`}
              className="text-sm text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
            >
              View lifecycle for {t.poNumber} →
            </Link>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold text-[var(--color-fg)]">
            <span className="font-mono">{t.transactionSetId}</span> · {t.controlNumber}
          </h1>
          <StatusBadge status={t.status} />
          <StageBadge stage={t.outboundStage} />
        </div>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t.senderId ?? '—'} → {t.receiverId ?? '—'}
          {t.ingestedAt ? ` · ingested ${new Date(t.ingestedAt).toLocaleString()}` : ''}
        </p>
      </div>

      {t.errorMessage ? (
        <div className="rounded-lg border border-[var(--color-error-500)]/30 bg-[var(--color-error-50)] p-3 text-sm text-[var(--color-error-700)]">
          <span className="font-medium">Parse error:</span> {t.errorMessage}
        </div>
      ) : null}

      {t.rejection ? <RejectionPanel rejection={t.rejection} /> : null}

      {/* Phase 8 Sprint 1 — three-step outbound lifecycle timeline. Renders
          only for outbound rows that have at least the generated stamp. */}
      <StageTimeline
        stage={t.outboundStage}
        generatedAt={t.generatedAt}
        transmittedAt={t.transmittedAt}
        confirmedAt={t.confirmedAt}
      />

      <section className="rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] p-4 shadow-xs">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">Header</h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          {header.map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)]">{k}</dt>
              <dd className="font-mono text-[var(--color-fg)]">{v || '—'}</dd>
            </div>
          ))}
        </dl>
      </section>

      {lineItems.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] shadow-xs">
          <div className="border-b border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] px-4 py-2 text-sm font-semibold text-[var(--color-fg)]">
            Line items ({lineItems.length})
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
              <tr>
                <th className="px-4 py-2">#</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">UOM</th>
                <th className="px-4 py-2">Unit price</th>
                <th className="px-4 py-2">Product</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((li: LineItem, i: number) => (
                <tr key={i} className="border-t border-[var(--color-surface-border)]">
                  <td className="px-4 py-2 font-mono">{li.lineNumber || i + 1}</td>
                  <td className="px-4 py-2 font-mono">{li.quantity}</td>
                  <td className="px-4 py-2">{li.unitOfMeasure}</td>
                  <td className="px-4 py-2 font-mono">{li.unitPrice}</td>
                  <td className="px-4 py-2 font-mono">{li.productId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] p-4 shadow-xs">
        <RawParsedView detail={t as TransactionDetail} />
      </section>
    </div>
  );
}

function RejectionPanel({ rejection }: { rejection: NonNullable<TransactionDetail['rejection']> }): JSX.Element {
  return (
    <section
      className="rounded-lg border border-[var(--color-error-500)]/30 bg-[var(--color-error-50)]/40 p-4"
      data-testid="rejection-panel"
    >
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-error-700)]">Why this was rejected</h2>
        <span className="rounded-full bg-[var(--color-error-500)]/15 px-2 py-0.5 text-xs font-medium text-[var(--color-error-700)]">
          {rejection.statusMessage ?? rejection.status}
        </span>
        <Link
          to={`/transactions/${rejection.ackTransactionId}`}
          className="ml-auto text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          View acknowledgment →
        </Link>
      </div>
      {rejection.summary ? (
        <p className="mb-3 text-sm text-[var(--color-error-700)]">{rejection.summary}</p>
      ) : null}
      {rejection.details.length > 0 ? (
        <ol className="space-y-3">
          {rejection.details.map((seg, i) => (
            <li key={i} className="rounded border border-[var(--color-error-500)]/20 bg-[var(--color-surface-card)] p-3 text-xs">
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-sm font-semibold text-[var(--color-fg)]">{seg.segmentTag || '—'}</span>
                {seg.segmentPosition ? (
                  <span className="text-[var(--color-fg-muted)]">@ position {seg.segmentPosition}</span>
                ) : null}
                {seg.loopIdentifier ? (
                  <span className="text-[var(--color-fg-muted)]">loop {seg.loopIdentifier}</span>
                ) : null}
                <span className="ml-auto text-[var(--color-fg-muted)]">
                  AK304 code <span className="font-mono">{seg.syntaxErrorCode || '—'}</span>
                </span>
              </div>
              <p className="text-[var(--color-fg-muted)]">
                {seg.syntaxErrorMessage ?? `Unknown segment-syntax code "${seg.syntaxErrorCode}"`}
              </p>
              {seg.elementErrors.length > 0 ? (
                <table className="mt-2 w-full text-xs">
                  <thead className="text-left text-[var(--color-fg-muted)]">
                    <tr>
                      <th className="px-2 py-1 font-medium">Position</th>
                      <th className="px-2 py-1 font-medium">X12 ref</th>
                      <th className="px-2 py-1 font-medium">Reason</th>
                      <th className="px-2 py-1 font-medium">Bad value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seg.elementErrors.map((el, j) => (
                      <tr key={j} className="border-t border-[var(--color-surface-border)]">
                        <td className="px-2 py-1 font-mono">
                          {seg.segmentTag && el.elementPosition
                            ? `${seg.segmentTag}${el.elementPosition.padStart(2, '0')}`
                            : el.elementPosition || '—'}
                        </td>
                        <td className="px-2 py-1 font-mono text-[var(--color-fg-muted)]">{el.dataElementReference || '—'}</td>
                        <td className="px-2 py-1 text-[var(--color-fg-muted)]">
                          {el.syntaxErrorMessage ?? `Unknown element-syntax code "${el.syntaxErrorCode}"`}
                        </td>
                        <td className="px-2 py-1 font-mono text-[var(--color-fg-muted)]">{el.badValue || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function headerFields(interp: InterpretedTransaction): Array<[string, string]> {
  switch (interp.type) {
    case '850':
      return [
        ['PO number', interp.poNumber],
        ['PO date', interp.poDate],
        ['Purpose', interp.purpose],
      ];
    case '855':
      return [
        ['PO number', interp.poNumber],
        ['Ack type', interp.ackType],
        ['Purpose', interp.purpose],
      ];
    case '856':
      return [
        ['PO number', interp.poNumber],
        ['Shipment ID', interp.shipmentId],
        ['Ship date', interp.shipDate],
      ];
    case '810':
      return [
        ['Invoice number', interp.invoiceNumber],
        ['Invoice date', interp.invoiceDate],
        ['PO number', interp.poNumber],
        ['Total', interp.totalAmount],
      ];
    case '860':
      return [
        ['PO number', interp.poNumber],
        ['Original PO', interp.originalPoNumber],
        ['PO date', interp.poDate],
        ['Purpose', interp.purpose],
      ];
    case '875':
      return [
        ['PO number', interp.poNumber],
        ['PO date', interp.poDate],
        ['Purpose', interp.purpose],
      ];
    case '880':
      return [
        ['Invoice number', interp.invoiceNumber],
        ['Invoice date', interp.invoiceDate],
        ['PO number', interp.poNumber],
        ['Total', interp.totalAmount],
      ];
    case '997':
      return [
        ['Acked group', interp.ackedGroupControl],
        ['Functional ID', interp.ackedFunctionalIdCode],
        ['Group status', interp.groupStatus],
      ];
    default:
      return [['Set', interp.transactionSetId]];
  }
}
