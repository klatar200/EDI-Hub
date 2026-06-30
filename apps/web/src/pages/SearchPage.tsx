/**
 * SearchPage — Phase 3.
 *
 * UI Phase Sprint 6 — token-migrated. Three result blocks: lifecycle entry
 * points (POs), transactions, raw files. Empty + error states share the
 * primitive surface. StatusPill replaces the legacy StatusBadge.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { RawFileRecord, TransactionSummary, LifecycleSearchHit } from '@edi/shared';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { usePreferMobileCards } from '../lib/useMediaQuery.ts';
import {
  TransactionMobileCards,
  SearchRawFileMobileCards,
} from '../components/MobileTableCards.tsx';
import {
  PageHeader,
  DataTable,
  StatusPill,
  rawFileTone,
  Card,
  ErrorState,
  EmptyState,
  Skeleton,
} from '../components/ui';

function lifecycleHref(lc: LifecycleSearchHit): string {
  const po = encodeURIComponent(lc.po);
  if (lc.entryKind === 'invoice' && lc.entryValue) {
    return `/lifecycle/${po}?invoice=${encodeURIComponent(lc.entryValue)}`;
  }
  if (lc.entryKind === 'shipment' && lc.entryValue) {
    return `/lifecycle/${po}?shipment=${encodeURIComponent(lc.entryValue)}`;
  }
  return `/lifecycle/${po}`;
}

function entryHint(lc: LifecycleSearchHit): string | null {
  if (lc.entryKind === 'invoice' && lc.entryValue) return `via invoice ${lc.entryValue}`;
  if (lc.entryKind === 'shipment' && lc.entryValue) return `via shipment ${lc.entryValue}`;
  return null;
}

export function SearchPage(): JSX.Element {
  const preferMobileCards = usePreferMobileCards();
  const [sp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const searchKey = useTenantQueryKey('search', q);
  const query = useQuery({ queryKey: searchKey, queryFn: () => api.search(q), enabled: q.length > 0 });

  const lifecycles = query.data?.lifecycles ?? [];
  const transactions = query.data?.transactions ?? [];
  const rawFiles = query.data?.rawFiles ?? [];
  const nothing = !query.isLoading && lifecycles.length === 0 && transactions.length === 0 && rawFiles.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span>
            Search <span className="text-[var(--color-fg-muted)]">“{q}”</span>
          </span>
        }
      />

      {query.isLoading ? (
        <Skeleton.List rows={3} columnWidths={['20%', '40%', '20%', '20%']} />
      ) : query.isError ? (
        <ErrorState
          title="Search failed"
          description="The API isn't responding. Make sure the server is running and try again."
          action={<button className="btn" onClick={() => query.refetch()}>Retry</button>}
        />
      ) : nothing ? (
        <EmptyState
          title="No matches"
          description={`No transactions or raw files match “${q}”. Try a PO number, invoice number, shipment ID, or ISA control number.`}
        />
      ) : (
        <>
          {lifecycles.length > 0 && (
            <Card>
              <Card.Header>
                <Card.Title>Lifecycle conversations ({lifecycles.length})</Card.Title>
              </Card.Header>
              <Card.Content>
                <ul className="space-y-2 text-sm">
                  {lifecycles.map((lc) => (
                    <li key={lc.po} className="flex flex-wrap items-center gap-2">
                      <Link
                        to={lifecycleHref(lc)}
                        className="font-mono font-medium text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
                      >
                        {lc.po}
                      </Link>
                      {entryHint(lc) ? (
                        <span className="text-xs text-[var(--color-fg-muted)]">({entryHint(lc)})</span>
                      ) : null}
                      {lc.partnerDisplayName ? (
                        <span className="text-[var(--color-fg-muted)]">{lc.partnerDisplayName}</span>
                      ) : null}
                      {lc.linkedPos && lc.linkedPos.length > 0 ? (
                        <span className="text-xs text-[var(--color-fg-muted)]">
                          also: {lc.linkedPos.join(', ')}
                        </span>
                      ) : null}
                      {lc.openAlertCount > 0 ? (
                        <StatusPill tone="error" size="sm">{lc.openAlertCount} alert(s)</StatusPill>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card.Content>
            </Card>
          )}

          {transactions.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
                Transactions ({transactions.length})
              </h2>
              {preferMobileCards ? (
                <TransactionMobileCards items={transactions} />
              ) : (
              <DataTable>
                <DataTable.Tbody>
                  {transactions.map((t: TransactionSummary) => (
                    <DataTable.Tr key={t.id}>
                      <DataTable.Td mono>{t.transactionSetId}</DataTable.Td>
                      <DataTable.Td>
                        <Link
                          to={`/transactions/${t.id}`}
                          className="truncate text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
                          title={t.poNumber ?? t.invoiceNumber ?? t.controlNumber}
                        >
                          {t.poNumber ?? t.invoiceNumber ?? t.controlNumber}
                        </Link>
                      </DataTable.Td>
                      <DataTable.Td muted className="max-w-[10rem] truncate" title={`${t.senderId} → ${t.receiverId}`}>
                        {t.senderId} → {t.receiverId}
                      </DataTable.Td>
                      <DataTable.Td>
                        {t.status ? (
                          <StatusPill tone={rawFileTone(t.status)} withDot>{t.status}</StatusPill>
                        ) : (
                          <span className="text-[var(--color-fg-subtle)]">—</span>
                        )}
                      </DataTable.Td>
                    </DataTable.Tr>
                  ))}
                </DataTable.Tbody>
              </DataTable>
              )}
            </section>
          )}

          {rawFiles.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
                Raw files ({rawFiles.length})
              </h2>
              {preferMobileCards ? (
                <SearchRawFileMobileCards items={rawFiles} />
              ) : (
              <DataTable>
                <DataTable.Tbody>
                  {rawFiles.map((r: RawFileRecord) => (
                    <DataTable.Tr key={r.id}>
                      <DataTable.Td mono>{r.isaControlNumber ?? '—'}</DataTable.Td>
                      <DataTable.Td>
                        <StatusPill tone="neutral" size="sm">{r.source}</StatusPill>
                      </DataTable.Td>
                      <DataTable.Td>
                        <StatusPill tone={rawFileTone(r.status)} withDot>{r.status}</StatusPill>
                      </DataTable.Td>
                      <DataTable.Td muted>{new Date(r.ingestedAt).toLocaleString()}</DataTable.Td>
                    </DataTable.Tr>
                  ))}
                </DataTable.Tbody>
              </DataTable>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
