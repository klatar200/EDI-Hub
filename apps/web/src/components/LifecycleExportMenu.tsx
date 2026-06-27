/**
 * PS-9 F34 — export lifecycle conversation as TXT, CSV, or PDF.
 */
import { useState } from 'react';
import { api } from '../lib/api.ts';
import { useToast } from '../lib/useToast.tsx';

type ExportFormat = 'txt' | 'csv' | 'pdf';

export function LifecycleExportMenu({ po }: { po: string }): JSX.Element {
  const toast = useToast();
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  async function exportFmt(format: ExportFormat): Promise<void> {
    setBusy(format);
    try {
      await api.exportLifecycle(po, format);
      toast.success(`Exported ${format.toUpperCase()}`);
    } catch (err) {
      toast.error('Export failed', {
        description: err instanceof Error ? err.message : 'Server returned an error.',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="lifecycle-export-menu">
      <span className="text-xs text-[var(--color-fg-muted)]">Export lifecycle:</span>
      {(['txt', 'csv', 'pdf'] as const).map((fmt) => (
        <button
          key={fmt}
          type="button"
          className="rounded border border-[var(--color-surface-border)] px-2 py-0.5 text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
          data-testid={`export-lifecycle-${fmt}`}
          disabled={busy !== null}
          onClick={() => void exportFmt(fmt)}
        >
          {busy === fmt ? '…' : fmt.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
