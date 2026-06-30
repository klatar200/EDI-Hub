/**
 * PS-9 F15 — side-by-side duplicate document compare on the same PO.
 */
import { useQuery } from '@tanstack/react-query';
import type { LifecycleEvent } from '@edi/shared';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { Skeleton } from './ui';

const DIRECTION_LABEL = { inbound: 'Inbound', outbound: 'Outbound', unknown: 'Unknown' } as const;

function CompareColumn({ event }: { event: LifecycleEvent }): JSX.Element {
  const rawKey = useTenantQueryKey('raw', event.rawFileId);
  const rawQ = useQuery({
    queryKey: rawKey,
    queryFn: () => api.rawContent(event.rawFileId!),
    staleTime: 60_000,
    enabled: Boolean(event.rawFileId),
  });
  const text = rawQ.data ?? '';
  const lines = text.split(/~|\r?\n/).map((l: string) => l.trim()).filter((l: string) => l.length > 0);

  return (
    <div
      className="min-w-0 flex-1 rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-bg)]"
      data-testid={`compare-column-${event.transactionId}`}
    >
      <div className="border-b border-[var(--color-surface-border)] px-3 py-2 text-xs">
        <div className="font-semibold text-[var(--color-fg)]">
          Copy {event.instanceIndex ?? '?'} · ctrl {event.controlNumber ?? '—'}
        </div>
        <div className="mt-1 text-[var(--color-fg-muted)]">
          {event.ingestedAt ? new Date(event.ingestedAt).toLocaleString() : '—'}
          {event.source ? ` · via ${event.source}` : ''}
          {event.isaControlNumber ? ` · ISA ${event.isaControlNumber}` : ''}
        </div>
      </div>
      <div className="max-h-64 overflow-auto p-2 font-mono text-[10px] leading-relaxed text-[var(--color-fg)]">
        {rawQ.isLoading ? (
          <div role="status" aria-busy="true" aria-label="Loading raw EDI" className="space-y-1">
            <Skeleton.Row width="70%" height="h-2.5" />
            <Skeleton.Row width="60%" height="h-2.5" />
            <Skeleton.Row width="75%" height="h-2.5" />
          </div>
        ) : rawQ.isError ? (
          <span className="text-[var(--color-error-700)]">Could not load raw file.</span>
        ) : lines.length === 0 ? (
          <span className="text-[var(--color-fg-muted)]">Empty file</span>
        ) : (
          lines.map((line: string, i: number) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
              {i < lines.length - 1 ? '~' : ''}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function DuplicateComparePanel({
  setId,
  direction,
  events,
}: {
  setId: string;
  direction: LifecycleEvent['direction'];
  events: LifecycleEvent[];
}): JSX.Element {
  const sorted = [...events].sort((a, b) => (a.instanceIndex ?? 0) - (b.instanceIndex ?? 0));

  return (
    <div
      className="mt-2 rounded-md border border-[var(--color-brand-500)]/30 bg-[var(--color-brand-50)]/30 p-3"
      data-testid={`duplicate-compare-${setId}-${direction}`}
    >
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-brand-700)]">
        Compare {setId} {DIRECTION_LABEL[direction]} · {sorted.length} copies
      </h4>
      <div className="mt-2 flex flex-col gap-3 md:flex-row">
        {sorted.map((e) => (
          <CompareColumn key={e.transactionId ?? e.rawFileId} event={e} />
        ))}
      </div>
    </div>
  );
}
