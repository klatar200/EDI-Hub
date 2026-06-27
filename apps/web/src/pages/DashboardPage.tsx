/**
 * PS-3 — Ops dashboard page (F1, F45–F48, F3).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { DashboardIngestWindow } from '@edi/shared';
import { api } from '../lib/api.ts';
import {
  PageHeader,
  Card,
  DataTable,
  StatusPill,
  Sparkline,
  ErrorState,
  Skeleton,
  FormField,
  Select,
} from '../components/ui';

const INGEST_WINDOWS: { value: DashboardIngestWindow; label: string }[] = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
];

function formatWhen(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

export function DashboardPage(): JSX.Element {
  const [ingestWindow, setIngestWindow] = useState<DashboardIngestWindow>('24h');
  const [rejectionDays, setRejectionDays] = useState<7 | 30>(7);

  const q = useQuery({
    queryKey: ['dashboard', ingestWindow, rejectionDays],
    queryFn: () => api.dashboard({ ingestWindow, rejectionWindowDays: rejectionDays }),
  });

  const d = q.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ops dashboard"
        subtitle="Traffic, alerts, ingest health, and partner status at a glance."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="Ingest window">
              <Select
                size="sm"
                value={ingestWindow}
                onChange={(e) => setIngestWindow(e.target.value as DashboardIngestWindow)}
              >
                {INGEST_WINDOWS.map((w) => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Rejection trend">
              <Select
                size="sm"
                value={rejectionDays}
                onChange={(e) => setRejectionDays(Number.parseInt(e.target.value, 10) as 7 | 30)}
              >
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
              </Select>
            </FormField>
          </div>
        }
      />

      {q.isLoading ? (
        <Skeleton.Table rows={4} columnWidths={['100%']} />
      ) : q.isError || !d ? (
        <ErrorState
          title="Could not load dashboard"
          description="The API isn't responding. Make sure the server is running and try again."
          action={<button type="button" className="btn" onClick={() => q.refetch()}>Retry</button>}
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <Card.Content className="!p-4">
                <h2 className="text-sm font-medium text-[var(--color-fg-muted)]">Traffic silence</h2>
                {d.trafficSilence.isGloballyStale ? (
                  <p className="mt-2 text-sm text-[var(--color-warn-700)]" data-testid="traffic-stale">
                    No EDI from any partner in {d.trafficSilence.staleWindowHours}h
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-[var(--color-fg)]">
                    All quiet since {formatWhen(d.trafficSilence.lastGlobalIngestAt)}
                  </p>
                )}
                <Link to="/" className="mt-2 inline-block text-xs text-[var(--color-brand-600)] hover:underline">
                  View lifecycles →
                </Link>
              </Card.Content>
            </Card>

            <Card>
              <Card.Content className="!p-4">
                <h2 className="text-sm font-medium text-[var(--color-fg-muted)]">Open alerts</h2>
                <p className="mt-2 text-2xl font-semibold tabular-nums" data-testid="open-alerts-total">
                  {d.openAlerts.total}
                </p>
                <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
                  {d.openAlerts.bySeverity.critical} critical · {d.openAlerts.bySeverity.warning} warning
                </p>
                <Link to="/alerts" className="mt-2 inline-block text-xs text-[var(--color-brand-600)] hover:underline">
                  View alerts →
                </Link>
              </Card.Content>
            </Card>

            <Card>
              <Card.Content className="!p-4">
                <h2 className="text-sm font-medium text-[var(--color-fg-muted)]">Ingest health</h2>
                <p className="mt-2 text-sm" data-testid="ingest-health">
                  <span className="text-[var(--color-success-700)]">{d.ingestHealth.parsed} parsed</span>
                  {' · '}
                  <span className="text-[var(--color-error-700)]">{d.ingestHealth.parseError} errors</span>
                  {' · '}
                  <span>{d.ingestHealth.duplicate} dup</span>
                </p>
                <Link to="/ingestions" className="mt-2 inline-block text-xs text-[var(--color-brand-600)] hover:underline">
                  Triage ingestions →
                </Link>
              </Card.Content>
            </Card>

            <Card>
              <Card.Content className="!p-4">
                <h2 className="text-sm font-medium text-[var(--color-fg-muted)]">Rejection trends</h2>
                {d.rejectionTrends.trends.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--color-fg-muted)]">No 997s in window</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {d.rejectionTrends.trends.slice(0, 3).map((t) => (
                      <li key={t.partner} className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs">{t.partner}</span>
                        <Sparkline.Line values={t.dailyRates} width={64} height={20} />
                      </li>
                    ))}
                  </ul>
                )}
                <Link to="/metrics" className="mt-2 inline-block text-xs text-[var(--color-brand-600)] hover:underline">
                  Full metrics →
                </Link>
              </Card.Content>
            </Card>
          </div>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">Partner health</h2>
            <DataTable>
              <DataTable.Thead>
                <DataTable.Tr>
                  <DataTable.Th>Partner</DataTable.Th>
                  <DataTable.Th>Last ingest</DataTable.Th>
                  <DataTable.Th>Last ack</DataTable.Th>
                  <DataTable.Th>Rejection % (30d)</DataTable.Th>
                  <DataTable.Th>Open alerts</DataTable.Th>
                </DataTable.Tr>
              </DataTable.Thead>
              <DataTable.Tbody>
                {d.partnerHealth.map((row) => (
                  <DataTable.Tr key={row.partnerId}>
                    <DataTable.Td>
                      <Link
                        to={`/partners-config`}
                        className="font-medium text-[var(--color-brand-600)] hover:underline"
                      >
                        {row.displayName}
                      </Link>
                    </DataTable.Td>
                    <DataTable.Td muted>{formatWhen(row.lastIngestAt)}</DataTable.Td>
                    <DataTable.Td muted>{formatWhen(row.lastAckAt)}</DataTable.Td>
                    <DataTable.Td mono numeric>{(row.rejectionRate30d * 100).toFixed(1)}%</DataTable.Td>
                    <DataTable.Td>
                      {row.openAlertCount > 0 ? (
                        <Link to={`/?hasAlerts=true&partnerId=${row.partnerId}`}>
                          <StatusPill tone="error" size="sm" withDot>{row.openAlertCount}</StatusPill>
                        </Link>
                      ) : (
                        <span className="text-[var(--color-fg-subtle)]">—</span>
                      )}
                    </DataTable.Td>
                  </DataTable.Tr>
                ))}
              </DataTable.Tbody>
            </DataTable>
          </section>
        </>
      )}
    </div>
  );
}
