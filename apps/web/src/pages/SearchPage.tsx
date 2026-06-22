/**
 * SearchPage — Phase 3.
 *
 * UI Phase Sprint 6 — token-migrated. Three result blocks: lifecycle entry
 * points (POs), transactions, raw files. Empty + error states share the
 * primitive surface. StatusPill replaces the legacy StatusBadge.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { RawFileRecord, TransactionSummary } from '@edi/shared';
import { api } from '../lib/api.ts';
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

export function SearchPage(): JSX.Element {
  const [sp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const query = useQuery({ queryKey: ['search', q], queryFn: () => api.search(q), enabled: q.length > 0 });

  const transactions = query.data?.transactions ?? [];
  const rawFiles = query.data?.rawFiles ?? [];
  const nothing = !query.isLoading && transactions.length === 0 && rawFiles.length === 0;

  // Distinct POs surfaced by the query — links straight to the lifecycle.
  const polySpine = Array.from(
    new Set(transactions.map((t) => t.poNumber).filter((p): p is string => !!p)),
  );

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
        <Skeleton.Table rows={3} columnWidths={['20%', '40%', '20%', '20%']} />
      ) : query.isError ? (
        <ErrorState
          title="Search failed"
          description="The API isn't responding. Make sure the server is running and try again."
          action={<button className="btn" onClick={() => query.refetch()}>Retry</button>}
        />
      ) : nothing ? (
        <EmptyState
          title="No matches"
          description={`No transactions or raw files match “${q}”. Try a PO number, invoice number, or ISA control number.`}
        />
      ) : (
        <>
          {polySpine.length > 0 && (
            <Card>
              <Card.Header>
                <Card.Title>Lifecycle ({polySpine.length})</Card.Title>
              </Card.Header>
              <Card.Content>
                <ul className="space-y-1 text-sm">
                  {polySpine.map((po) => (
                    <li key={po}>
                      <Link
                        to={`/lifecycle/${encodeURIComponent(po)}`}
                        className="font-mono text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
                      >
                        {po}
                      </Link>
                      <span className="ml-2 text-[var(--color-fg-subtle)]">— see the full chain</span>
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
              <DataTable>
                <DataTable.Tbody>
                  {transactions.map((t: TransactionSummary) => (
                    <DataTable.Tr key={t.id}>
                      <DataTable.Td mono>{t.transactionSetId}</DataTable.Td>
                      <DataTable.Td>
                        <Link
                          to={`/transactions/${t.id}`}
                          className="text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
                        >
                          {t.poNumber ?? t.invoiceNumber ?? t.controlNumber}
                        </Link>
                      </DataTable.Td>
                      <DataTable.Td muted>
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
            </section>
          )}

          {rawFiles.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
                Raw files ({rawFiles.length})
              </h2>
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
            </section>
          )}
        </>
      )}
    </div>
  );
}
