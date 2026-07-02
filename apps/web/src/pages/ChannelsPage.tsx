/**
 * PS-7 — Channel health page (F10).
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ChannelHealthRecord } from '@edi/shared';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { PageHeader, Card, StatusPill, ErrorState, Skeleton, EmptyState } from '../components/ui';

function statusTone(status: ChannelHealthRecord['status']): 'success' | 'neutral' | 'error' {
  if (status === 'running') return 'success';
  if (status === 'error') return 'error';
  return 'neutral';
}

export function ChannelsPage(): JSX.Element {
  const channelsKey = useTenantQueryKey('channels');
  const q = useQuery({ queryKey: channelsKey, queryFn: () => api.channels.list(), refetchInterval: 30_000 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Channels"
        subtitle="SFTP, AS2, and upload — inbound health by channel."
      />
      {q.isLoading ? <Skeleton.Table rows={3} columnWidths={['40%', '30%', '30%']} /> : null}
      {q.isError ? (
        <ErrorState
          title="Could not load channel health"
          action={<button type="button" className="btn" onClick={() => void q.refetch()}>Retry</button>}
        />
      ) : null}
      {q.data?.channels.length === 0 ? (
        <EmptyState title="No channels" description="No inbound channels are registered on this hub." />
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {q.data?.channels.map((ch) => (
          <Card key={ch.name} className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium">{ch.name}</h3>
              <StatusPill tone={statusTone(ch.status)} size="sm">{ch.status}</StatusPill>
            </div>
            <p className="text-sm text-[var(--color-fg-muted)]">Source: {ch.source}</p>
            {ch.error ? <p className="break-words text-sm text-[var(--color-error-700)]">{ch.error}</p> : null}
            {ch.detail ? (
              <dl className="text-xs text-[var(--color-fg-muted)]">
                {Object.entries(ch.detail).map(([k, v]) => (
                  <div key={k}><dt className="inline font-medium">{k}: </dt><dd className="inline font-mono">{v}</dd></div>
                ))}
              </dl>
            ) : null}
            <Link
              to={`/ingestions?source=${ch.source}`}
              className="text-sm text-[var(--color-brand-600)] hover:underline"
            >
              View received files →
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
