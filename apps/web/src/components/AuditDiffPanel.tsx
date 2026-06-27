/**
 * PB-6 F22 — before/after diff for audit log rows.
 */
import type { AuditEventRecord } from '@edi/shared';

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function readDiff(payloadDiff: unknown): { before: unknown; after: unknown } {
  if (typeof payloadDiff !== 'object' || payloadDiff === null) {
    return { before: null, after: null };
  }
  const d = payloadDiff as Record<string, unknown>;
  return { before: d.before ?? null, after: d.after ?? null };
}

export function AuditDiffPanel({ row }: { row: AuditEventRecord }): JSX.Element {
  const { before, after } = readDiff(row.payloadDiff);
  const hasDiff = before !== null || after !== null;
  if (!hasDiff) {
    return <p className="text-xs text-[var(--color-fg-muted)]">No before/after payload recorded.</p>;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid={`audit-diff-${row.id}`}>
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">Before</h4>
        <pre className="max-h-64 overflow-auto rounded border border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] p-2 text-[11px] leading-relaxed">
          {formatJson(before)}
        </pre>
      </div>
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">After</h4>
        <pre className="max-h-64 overflow-auto rounded border border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] p-2 text-[11px] leading-relaxed">
          {formatJson(after)}
        </pre>
      </div>
    </div>
  );
}
