/**
 * UI Phase Sprint 2.5 — Ingestions page, polished.
 *
 * Lists raw EDI files in arrival order. ISA control number is mono
 * (it's a 9-digit identifier the operator reads digit-by-digit). Status
 * pills replace the bespoke StatusBadge. Empty / error / skeleton
 * states use the shared primitives.
 */
import { useQuery } from '@tanstack/react-query';
import type { RawFileRecord } from '@edi/shared';
import { api } from '../lib/api.ts';
import {
  PageHeader,
  DataTable,
  StatusPill,
  rawFileTone,
  ErrorState,
  EmptyState,
  Skeleton,
} from '../components/ui';

export function IngestionsPage(): JSX.Element {
  const q = useQuery({ queryKey: ['ingest'], queryFn: () => api.ingest({ limit: 50 }) });
  const items = q.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Ingestions"
        subtitle="Every raw EDI transmission received by the hub, newest first."
        actions={
          <span className="text-sm text-[var(--color-fg-muted)] tabular-nums">
            {q.isLoading ? 'Loading…' : `${items.length} shown`}
          </span>
        }
      />

      {q.isLoading ? (
        <Skeleton.Table rows={6} columnWidths={['30%', '14%', '14%', '20%']} />
      ) : q.isError ? (
        <ErrorState
          title="Could not load ingestions"
          description="The API isn't responding. Make sure the server is running and try again."
          action={<button className="btn" onClick={() => q.refetch()}>Retry</button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No ingestions yet"
          description="Drop an EDI file into the configured SFTP folder, or POST one to /ingest/upload, and it'll appear here."
        />
      ) : (
        <DataTable>
          <DataTable.Thead>
            <DataTable.Tr>
              <DataTable.Th>ISA control #</DataTable.Th>
              <DataTable.Th>Source</DataTable.Th>
              <DataTable.Th>Status</DataTable.Th>
              <DataTable.Th>Ingested</DataTable.Th>
            </DataTable.Tr>
          </DataTable.Thead>
          <DataTable.Tbody>
            {items.map((r: RawFileRecord) => (
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
    </div>
  );
}
