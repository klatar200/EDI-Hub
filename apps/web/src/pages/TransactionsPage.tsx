/**
 * UI Phase Sprint 2.4 — Transactions page, polished.
 *
 * Uses the new primitive set: PageHeader, FilterChipRow, DataTable,
 * StatusPill, Pagination, ErrorState, EmptyState, Skeleton. Filter
 * controls live in a Card-shaped strip; active filters render as
 * removable chips above the table so the operator can see at a glance
 * what's narrowing the result set.
 *
 * Functionally identical to the previous page — same data, same URL
 * search-param model, same partner-resolution logic.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { TransactionSummary } from '@edi/shared';
import { api, type TransactionFilters } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import {
  TableDisplayMenu,
  useTableDisplayPrefs,
  type TableColumnDef,
} from '../components/TableDisplayMenu.tsx';
import { TransactionMobileCards } from '../components/MobileTableCards.tsx';
import { usePreferMobileCards } from '../lib/useMediaQuery.ts';
import {
  PageHeader,
  DataTable,
  StatusPill,
  rawFileTone,
  Pagination,
  FilterChip,
  FilterChipRow,
  FilterToolbar,
  ErrorState,
  EmptyState,
  Skeleton,
  Card,
  FormField,
  Input,
  Select,
} from '../components/ui';

const PAGE_SIZE = 25;
const TRANSACTION_COLUMNS: TableColumnDef[] = [
  { id: 'set', label: 'Set' },
  { id: 'poInvoice', label: 'PO / Invoice', required: true },
  { id: 'direction', label: 'Direction' },
  { id: 'sender', label: 'Sender' },
  { id: 'receiver', label: 'Receiver' },
  { id: 'status', label: 'Status' },
  { id: 'ingested', label: 'Ingested' },
  { id: 'lifecycle', label: 'Lifecycle' },
];
const SETS = ['850', '855', '856', '860', '875', '880', '810', '997'];
const STATUSES = ['RECEIVED', 'PARSED', 'PARSE_ERROR', 'UNRECOGNIZED_FORMAT', 'DUPLICATE', 'FAILED'];
const DIRECTIONS = [
  { value: 'inbound', label: 'Inbound' },
  { value: 'outbound', label: 'Outbound' },
  { value: 'unknown', label: 'Unknown' },
] as const;

const DIRECTION_LABEL: Record<string, string> = {
  inbound: 'Inbound',
  outbound: 'Outbound',
  unknown: 'Unknown',
};

export interface TransactionsPageProps {
  /** N3 — when rendered inside the Documents explorer, the parent already
   *  shows the page title and segmented toggle. Suppress this page's own
   *  PageHeader so the chrome doesn't stack. */
  hideHeader?: boolean;
}

export function TransactionsPage({ hideHeader = false }: TransactionsPageProps = {}): JSX.Element {
  const [sp, setSp] = useSearchParams();
  const partnersKey = useTenantQueryKey('partners');
  const partnersConfigKey = useTenantQueryKey('partners-config');
  const partnersQ = useQuery({ queryKey: partnersKey, queryFn: () => api.partners() });
  const partnersConfigQ = useQuery({ queryKey: partnersConfigKey, queryFn: () => api.partnersConfig.list() });
  const preferencesKey = useTenantQueryKey('preferences');
  const preferencesQ = useQuery({ queryKey: preferencesKey, queryFn: () => api.preferences.get() });
  const tableDisplay = useTableDisplayPrefs(
    'transactions',
    preferencesQ.data?.preferences,
    TRANSACTION_COLUMNS,
  );
  const { isColumnVisible, density } = tableDisplay;

  const offset = Math.max(Number.parseInt(sp.get('offset') ?? '0', 10) || 0, 0);
  const filters: TransactionFilters = {
    set: sp.get('set') ?? undefined,
    partner: sp.get('partner') ?? undefined,
    status: sp.get('status') ?? undefined,
    po: sp.get('po') ?? undefined,
    invoice: sp.get('invoice') ?? undefined,
    direction: sp.get('direction') ?? undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    limit: PAGE_SIZE,
    offset,
  };
  const txKey = useTenantQueryKey('transactions', filters);
  const txQ = useQuery({ queryKey: txKey, queryFn: () => api.transactions(filters) });

  function setFilter(key: string, value: string | undefined): void {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('offset'); // reset pagination on filter change
    setSp(next);
  }
  function clearAll(): void {
    setSp(new URLSearchParams());
  }
  function setOffset(o: number): void {
    const next = new URLSearchParams(sp);
    if (o > 0) next.set('offset', String(o));
    else next.delete('offset');
    setSp(next);
  }

  const items = txQ.data?.items ?? [];
  const hasAnyFilter = Boolean(
    filters.set || filters.partner || filters.status || filters.po
    || filters.invoice || filters.direction || filters.from || filters.to,
  );
  const secondaryFilterCount = [
    filters.direction,
    filters.partner,
    filters.po,
    filters.invoice,
    filters.from,
    filters.to,
  ].filter(Boolean).length;

  // Partner option list — configured names first, then any "raw" ISA ids
  // that aren't yet claimed by a configured partner.
  const configured = partnersConfigQ.data?.items ?? [];
  const claimed = new Set(configured.flatMap((p) => [...p.isaSenderIds, ...p.isaReceiverIds]));
  const inferred = (partnersQ.data?.partners ?? []).filter((id) => !claimed.has(id));
  const preferMobileCards = usePreferMobileCards();

  return (
    <div>
      {hideHeader ? null : (
        <PageHeader
          title="Transactions"
          subtitle="Every decoded EDI transaction across your trading partners."
          actions={
            <span className="text-sm text-[var(--color-fg-muted)] tabular-nums">
              {txQ.isLoading ? (
                <Skeleton.Row width="5rem" height="h-4" className="inline-block" />
              ) : (
                `${items.length} shown`
              )}
            </span>
          }
        />
      )}

      {/* Filter controls — selects + PO input, in a Card-shaped strip. */}
      <Card className="container-panel mb-3">
        <div className="p-3">
          <FilterToolbar
            activeSecondaryCount={secondaryFilterCount}
            inline={
              <>
                <FormField label="Type">
                  <Select size="sm" value={filters.set ?? ''} onChange={(e) => setFilter('set', e.target.value || undefined)}>
                    <option value="">All</option>
                    {SETS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </FormField>
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
                <FormField label="Direction">
                  <Select size="sm" value={filters.direction ?? ''} onChange={(e) => setFilter('direction', e.target.value || undefined)}>
                    <option value="">All</option>
                    {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </Select>
                </FormField>
                <FormField label="Partner">
                  <Select size="sm" value={filters.partner ?? ''} onChange={(e) => setFilter('partner', e.target.value || undefined)}>
                    <option value="">All</option>
                    {configured
                      .filter((p) => p.isaSenderIds[0] || p.isaReceiverIds[0])
                      .map((p) => {
                        const v = p.isaSenderIds[0] ?? p.isaReceiverIds[0]!;
                        return <option key={p.id} value={v}>{p.displayName}</option>;
                      })}
                    {inferred.length > 0 && configured.length > 0 ? <option disabled>──────</option> : null}
                    {inferred.map((id) => <option key={id} value={id}>{id}</option>)}
                  </Select>
                </FormField>
                <FormField label="PO number">
                  <Input size="sm" placeholder="PO-…" value={filters.po ?? ''} onChange={(e) => setFilter('po', e.target.value || undefined)} />
                </FormField>
                <FormField label="Invoice">
                  <Input size="sm" placeholder="INV-…" value={filters.invoice ?? ''} onChange={(e) => setFilter('invoice', e.target.value || undefined)} />
                </FormField>
                <FormField label="From">
                  <Input size="sm" type="date" value={filters.from ?? ''} onChange={(e) => setFilter('from', e.target.value || undefined)} />
                </FormField>
                <FormField label="To">
                  <Input size="sm" type="date" value={filters.to ?? ''} onChange={(e) => setFilter('to', e.target.value || undefined)} />
                </FormField>
              </>
            }
            trailing={
              preferencesQ.data ? (
                <TableDisplayMenu
                  tableKey="transactions"
                  preferences={preferencesQ.data.preferences}
                  columns={TRANSACTION_COLUMNS}
                />
              ) : null
            }
          />
        </div>
      </Card>

      {/* Active-filter chips above the table — quick removal without scrolling. */}
      <FilterChipRow onClearAll={hasAnyFilter ? clearAll : undefined}>
        {filters.set       ? <FilterChip key="set"       label="Set"       value={filters.set}       onRemove={() => setFilter('set',       undefined)} /> : null}
        {filters.direction ? <FilterChip key="direction" label="Direction" value={DIRECTION_LABEL[filters.direction] ?? filters.direction} onRemove={() => setFilter('direction', undefined)} /> : null}
        {filters.partner   ? <FilterChip key="partner"   label="Partner"   value={filters.partner}   onRemove={() => setFilter('partner',   undefined)} /> : null}
        {filters.status    ? <FilterChip key="status"    label="Status"    value={filters.status}    onRemove={() => setFilter('status',    undefined)} /> : null}
        {filters.po        ? <FilterChip key="po"        label="PO"        value={filters.po}        onRemove={() => setFilter('po',        undefined)} /> : null}
        {filters.invoice   ? <FilterChip key="invoice"   label="Invoice"   value={filters.invoice}   onRemove={() => setFilter('invoice',   undefined)} /> : null}
        {filters.from      ? <FilterChip key="from"      label="From"      value={filters.from}      onRemove={() => setFilter('from',      undefined)} /> : null}
        {filters.to        ? <FilterChip key="to"        label="To"        value={filters.to}        onRemove={() => setFilter('to',        undefined)} /> : null}
      </FilterChipRow>

      {txQ.isLoading ? (
        <Skeleton.List rows={6} columnWidths={['8%', '20%', '14%', '14%', '12%', '20%', '12%']} />
      ) : txQ.isError ? (
        <ErrorState
          title="Could not load transactions"
          description="The API isn't responding. Make sure the server is running and try again."
          action={<button className="btn" onClick={() => txQ.refetch()}>Retry</button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={hasAnyFilter ? 'No transactions match these filters' : 'No transactions yet'}
          description={
            hasAnyFilter
              ? 'Try widening the filters above or clear them entirely.'
              : 'Once partners send EDI through the configured channels, decoded transactions will appear here.'
          }
          action={hasAnyFilter ? <button className="btn" onClick={clearAll}>Clear filters</button> : null}
        />
      ) : (
        <>
        {preferMobileCards ? <TransactionMobileCards items={items} /> : null}
        {preferMobileCards ? null : (
        <DataTable density={density}>
          <DataTable.Thead>
            <DataTable.Tr>
              {isColumnVisible('set') ? <DataTable.Th>Set</DataTable.Th> : null}
              <DataTable.Th>PO / Invoice</DataTable.Th>
              {isColumnVisible('direction') ? <DataTable.Th>Direction</DataTable.Th> : null}
              {isColumnVisible('sender') ? <DataTable.Th>Sender</DataTable.Th> : null}
              {isColumnVisible('receiver') ? <DataTable.Th>Receiver</DataTable.Th> : null}
              {isColumnVisible('status') ? <DataTable.Th>Status</DataTable.Th> : null}
              {isColumnVisible('ingested') ? <DataTable.Th>Ingested</DataTable.Th> : null}
              {isColumnVisible('lifecycle') ? <DataTable.Th>Lifecycle</DataTable.Th> : null}
            </DataTable.Tr>
          </DataTable.Thead>
          <DataTable.Tbody>
            {items.map((t: TransactionSummary) => (
              <DataTable.Tr key={t.id}>
                {isColumnVisible('set') ? <DataTable.Td mono>{t.transactionSetId}</DataTable.Td> : null}
                <DataTable.Td>
                  <Link
                    to={`/transactions/${t.id}`}
                    className="font-medium text-[var(--color-fg)] underline decoration-[var(--color-surface-border)] underline-offset-2 hover:decoration-[var(--color-brand-500)]"
                  >
                    {t.poNumber ?? t.invoiceNumber ?? t.controlNumber}
                  </Link>
                </DataTable.Td>
                {isColumnVisible('direction') ? (
                  <DataTable.Td>
                    <StatusPill tone={t.direction === 'inbound' ? 'info' : t.direction === 'outbound' ? 'brand' : 'neutral'} size="sm">
                      {DIRECTION_LABEL[t.direction] ?? t.direction}
                    </StatusPill>
                  </DataTable.Td>
                ) : null}
                {isColumnVisible('sender') ? <DataTable.Td>{t.senderId ?? '—'}</DataTable.Td> : null}
                {isColumnVisible('receiver') ? <DataTable.Td>{t.receiverId ?? '—'}</DataTable.Td> : null}
                {isColumnVisible('status') ? (
                  <DataTable.Td>
                    {t.status ? (
                      <StatusPill tone={rawFileTone(t.status)} withDot>
                        {t.status}
                      </StatusPill>
                    ) : (
                      <span className="text-[var(--color-fg-subtle)]">—</span>
                    )}
                  </DataTable.Td>
                ) : null}
                {isColumnVisible('ingested') ? (
                  <DataTable.Td muted>
                    {t.ingestedAt ? new Date(t.ingestedAt).toLocaleString() : '—'}
                  </DataTable.Td>
                ) : null}
                {isColumnVisible('lifecycle') ? (
                  <DataTable.Td>
                    {t.poNumber ? (
                      <Link
                        to={`/lifecycle/${encodeURIComponent(t.poNumber)}`}
                        className="text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
                      >
                        View →
                      </Link>
                    ) : (
                      <span className="text-[var(--color-fg-subtle)]">—</span>
                    )}
                  </DataTable.Td>
                ) : null}
              </DataTable.Tr>
            ))}
          </DataTable.Tbody>
        </DataTable>
        )}
        </>
      )}

      <Pagination
        offset={offset}
        limit={PAGE_SIZE}
        count={items.length}
        stickyMobile={preferMobileCards}
        onChange={setOffset}
      />
    </div>
  );
}
