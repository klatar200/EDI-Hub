/**
 * PS-11 — Admin audit log viewer (F22).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { PageHeader, Card, DataTable, FormField, Input, ErrorState, Skeleton, Pagination } from '../components/ui';

const PAGE_SIZE = 50;

export function AuditPage(): JSX.Element {
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);

  const q = useQuery({
    queryKey: ['audit', action, offset],
    queryFn: () => api.audit.list({ action: action || undefined, limit: PAGE_SIZE, offset }),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Audit log" subtitle="Tenant-scoped mutation history (admin only)." />
      <Card className="p-4">
        <FormField label="Filter by action">
          <Input
            placeholder="e.g. partner.update"
            value={action}
            onChange={(e) => { setAction(e.target.value); setOffset(0); }}
          />
        </FormField>
      </Card>
      {q.isLoading ? <Skeleton.Table rows={6} columnWidths={['25%', '25%', '25%', '25%']} /> : null}
      {q.isError ? (
        <ErrorState
          title="Could not load audit log"
          action={<button type="button" className="btn" onClick={() => void q.refetch()}>Retry</button>}
        />
      ) : null}
      {q.data ? (
        <>
          <DataTable>
            <DataTable.Thead>
              <DataTable.Tr>
                <DataTable.Th>When</DataTable.Th>
                <DataTable.Th>Action</DataTable.Th>
                <DataTable.Th>Target</DataTable.Th>
                <DataTable.Th>Actor</DataTable.Th>
              </DataTable.Tr>
            </DataTable.Thead>
            <DataTable.Tbody>
              {q.data.items.map((row) => (
                <DataTable.Tr key={row.id}>
                  <DataTable.Td muted>{new Date(row.createdAt).toLocaleString()}</DataTable.Td>
                  <DataTable.Td><span className="font-mono text-xs">{row.action}</span></DataTable.Td>
                  <DataTable.Td muted>{row.targetType} · {row.targetId.slice(0, 8)}…</DataTable.Td>
                  <DataTable.Td muted>{row.actorId?.slice(0, 8) ?? 'system'}…</DataTable.Td>
                </DataTable.Tr>
              ))}
            </DataTable.Tbody>
          </DataTable>
          <Pagination count={q.data.count} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
        </>
      ) : null}
    </div>
  );
}
