/**
 * UI Phase Sprint 5.2 — Metrics page, polished.
 *
 * Per-partner rolling-window rejection rate, now rendered with the
 * shared primitive set. The rate visual is a token-colored Sparkline.RateBar
 * that swaps colors at 2% / 10% thresholds — green / amber / red so an
 * operator scanning the dashboard sees the worst rows instantly.
 *
 * Functionally identical to the previous page — same data, same window
 * selector, same strict X12 definition of "rejected".
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RejectionRateRow } from '@edi/shared';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import {
  PageHeader,
  DataTable,
  Sparkline,
  ErrorState,
  EmptyState,
  Skeleton,
  FormField,
  Select,
} from '../components/ui';

const WINDOWS: Array<{ days: number; label: string }> = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

function windowFrom(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function ratePct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function MetricsPage(): JSX.Element {
  const [days, setDays] = useState<number>(30);
  const from = windowFrom(days);
  const rateKey = useTenantQueryKey('rejection-rate', days);
  const q = useQuery({
    queryKey: rateKey,
    queryFn: () => api.rejectionRate({ from }),
  });

  return (
    <div>
      <PageHeader
        title="Rejection rate by partner"
        subtitle="Rolling window — rejected counts use the strict X12 definition (AK5 = R or M)."
        actions={
          <FormField label="Window">
            <Select
              size="sm"
              id="window-select"
              value={days}
              onChange={(e) => setDays(Number.parseInt(e.target.value, 10))}
            >
              {WINDOWS.map((w) => (
                <option key={w.days} value={w.days}>{w.label}</option>
              ))}
            </Select>
          </FormField>
        }
      />

      {q.isLoading ? (
        <Skeleton.Table rows={4} columnWidths={['25%', '15%', '15%', '15%', '30%']} />
      ) : q.isError ? (
        <ErrorState
          title="Could not load metrics"
          description="The API isn't responding. Make sure the server is running and try again."
          action={<button className="btn" onClick={() => q.refetch()}>Retry</button>}
        />
      ) : !q.data || q.data.rows.length === 0 ? (
        <EmptyState
          title="No 997s ingested in this window"
          description="As acknowledgments arrive, partners and rejection rates will appear here."
        />
      ) : (
        <DataTable>
          <DataTable.Thead>
            <DataTable.Tr>
              <DataTable.Th>Partner</DataTable.Th>
              <DataTable.Th>Total acked</DataTable.Th>
              <DataTable.Th>Rejected</DataTable.Th>
              <DataTable.Th>Rate</DataTable.Th>
              <DataTable.Th>Visual</DataTable.Th>
            </DataTable.Tr>
          </DataTable.Thead>
          <DataTable.Tbody>
            {q.data.rows.map((row: RejectionRateRow) => (
              <DataTable.Tr key={row.partner}>
                <DataTable.Td mono>{row.partner}</DataTable.Td>
                <DataTable.Td mono numeric>{row.total}</DataTable.Td>
                <DataTable.Td mono numeric>{row.rejected}</DataTable.Td>
                <DataTable.Td mono numeric>{ratePct(row.rate)}</DataTable.Td>
                <DataTable.Td>
                  <Sparkline.RateBar value={row.rate} />
                </DataTable.Td>
              </DataTable.Tr>
            ))}
          </DataTable.Tbody>
        </DataTable>
      )}

      {q.data ? (
        <p className="mt-3 text-xs text-[var(--color-fg-subtle)]">
          Window {new Date(q.data.windowFrom).toLocaleDateString()} →{' '}
          {new Date(q.data.windowTo).toLocaleDateString()} · {q.data.rows.length} partner(s)
        </p>
      ) : null}
    </div>
  );
}
