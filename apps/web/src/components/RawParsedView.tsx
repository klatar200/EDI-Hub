import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type TransactionDetail, type DetailSegment } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { Skeleton } from './ui';

type Mode = 'split' | 'parsed' | 'raw';

/** Reconstruct a segment's raw string (tag + element values joined). */
function segmentRaw(seg: DetailSegment, elementSep: string): string {
  const values = [...seg.elements].sort((a, b) => a.index - b.index).map((e) => e.value);
  return [seg.tag, ...values].join(elementSep);
}

export function RawParsedView({ detail }: { detail: TransactionDetail }): JSX.Element {
  const [mode, setMode] = useState<Mode>('split');
  const [selected, setSelected] = useState<string | null>(null);
  const elementSep = detail.delimiters?.element ?? '*';
  const segmentSep = detail.delimiters?.segment ?? '~';

  const rawKey = useTenantQueryKey('raw', detail.rawFileId);
  const rawQ = useQuery({
    queryKey: rawKey,
    queryFn: () => api.rawContent(detail.rawFileId as string),
    enabled: Boolean(detail.rawFileId),
  });

  const rawLines = useMemo(() => {
    if (!rawQ.data) return [];
    return rawQ.data.split(segmentSep).map((l) => l.trim()).filter((l) => l.length > 0);
  }, [rawQ.data, segmentSep]);

  const segments = [...detail.segments].sort((a, b) => a.position - b.position);

  const showParsed = mode === 'split' || mode === 'parsed';
  const showRaw = mode === 'split' || mode === 'raw';

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-fg)]">Raw vs parsed</h2>
        <div className="ml-auto inline-flex overflow-hidden rounded-md border border-[var(--color-surface-border)] text-xs">
          {(['split', 'parsed', 'raw'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1 capitalize transition ${
                mode === m
                  ? 'bg-[var(--color-brand-500)] text-white'
                  : 'bg-[var(--color-surface-card)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-muted)]'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className={`grid gap-4 ${mode === 'split' ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
        {showParsed && (
          <div className="overflow-hidden rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] shadow-xs">
            <div className="border-b border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
              Parsed segments
            </div>
            <ul className="divide-y divide-[var(--color-surface-border)]">
              {segments.map((seg) => {
                const raw = segmentRaw(seg, elementSep);
                const active = selected === raw;
                return (
                  <li
                    key={seg.position}
                    onClick={() => setSelected(raw)}
                    className={`cursor-pointer px-3 py-2 text-sm transition ${
                      active
                        ? 'bg-[var(--color-brand-50)]'
                        : 'hover:bg-[var(--color-surface-muted)]'
                    }`}
                  >
                    <span className="mr-2 font-mono font-semibold text-[var(--color-fg)]">{seg.tag}</span>
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1 text-xs text-[var(--color-fg-muted)]">
                      {seg.elements.map((e) => (
                        <span key={e.index}>
                          <span className="font-mono text-[var(--color-fg-subtle)]">
                            {seg.tag}{String(e.index).padStart(2, '0')}
                          </span>{' '}
                          <span className="font-mono text-[var(--color-fg)]">{e.value || '∅'}</span>
                          {e.semanticLabel ? (
                            <span className="text-[var(--color-fg-subtle)]"> · {e.semanticLabel}</span>
                          ) : null}
                        </span>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {showRaw && (
          <div className="overflow-hidden rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] shadow-xs">
            <div className="border-b border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
              Raw transmission
            </div>
            {rawQ.isLoading ? (
              <div
                role="status"
                aria-busy="true"
                aria-label="Loading raw bytes"
                className="space-y-1.5 p-3"
              >
                <Skeleton.Row width="85%" height="h-3" />
                <Skeleton.Row width="75%" height="h-3" />
                <Skeleton.Row width="80%" height="h-3" />
                <Skeleton.Row width="60%" height="h-3" />
              </div>
            ) : rawQ.isError ? (
              <div className="p-3 text-sm text-[var(--color-error-700)]">Could not load the raw file.</div>
            ) : (
              <pre className="overflow-x-auto p-0 text-xs leading-5">
                {rawLines.map((line, i) => (
                  <div
                    key={i}
                    onClick={() => setSelected(line)}
                    className={`cursor-pointer px-3 py-0.5 font-mono transition ${
                      selected === line
                        ? 'bg-[var(--color-brand-50)]'
                        : 'hover:bg-[var(--color-surface-muted)]'
                    }`}
                  >
                    {line}
                  </div>
                ))}
              </pre>
            )}
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-[var(--color-fg-subtle)]">
        Click a segment on either side to highlight it in both.
      </p>
    </div>
  );
}
