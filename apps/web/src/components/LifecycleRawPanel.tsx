import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { Skeleton } from './ui';

/** Lazy-loaded raw EDI viewer for lifecycle timeline events. */
export function LifecycleRawPanel({ rawFileId }: { rawFileId: string }): JSX.Element {
  const rawKey = useTenantQueryKey('raw', rawFileId);
  const rawQ = useQuery({
    queryKey: rawKey,
    queryFn: () => api.rawContent(rawFileId),
    staleTime: 60_000,
  });

  if (rawQ.isLoading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading raw EDI"
        className="space-y-1.5 py-1"
      >
        <Skeleton.Row width="80%" height="h-3" />
        <Skeleton.Row width="70%" height="h-3" />
        <Skeleton.Row width="85%" height="h-3" />
      </div>
    );
  }
  if (rawQ.isError) {
    return <p className="text-xs text-[var(--color-error-700)]">Could not load raw file.</p>;
  }

  const text = rawQ.data ?? '';
  const lines = text.split(/~|\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  return (
    <div
      data-testid="lifecycle-raw-panel"
      className="max-h-72 overflow-auto rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] p-2 font-mono text-[11px] leading-relaxed text-[var(--color-fg)]"
    >
      {lines.length === 0 ? (
        <span className="text-[var(--color-fg-muted)]">Empty file</span>
      ) : (
        lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {line}
            {i < lines.length - 1 ? '~' : ''}
          </div>
        ))
      )}
    </div>
  );
}
