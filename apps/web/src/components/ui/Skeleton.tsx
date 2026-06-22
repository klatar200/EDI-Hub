/**
 * UI Phase Sprint 2.2 — Skeleton loaders.
 *
 * Token-aware replacement for the old slate-based skeleton. Two flavors:
 *   - <Skeleton.Row /> for a single shimmer bar (use inline anywhere).
 *   - <Skeleton.Table rows={N} /> for the table-loading placeholder.
 *
 * Animation is a slow opacity pulse — restrained, not distracting.
 */
import type { ReactNode } from 'react';

interface RowProps {
  /** Width as a percentage string ("60%") or any valid Tailwind width class. */
  width?: string;
  /** Height — defaults to "h-4". */
  height?: string;
  className?: string;
}

function Row({ width = '100%', height = 'h-4', className = '' }: RowProps): JSX.Element {
  return (
    <div
      className={`animate-pulse rounded bg-[var(--color-surface-muted)] ${height} ${className}`}
      style={{ width }}
    />
  );
}

interface TableProps {
  rows?: number;
  /** Column width hints — defaults are roughly 7 even-ish columns. */
  columnWidths?: string[];
}

function TableSkeleton({
  rows = 5,
  columnWidths = ['40%', '24%', '20%', '20%', '16%'],
}: TableProps): JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading content"
      className="overflow-hidden rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] shadow-xs"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex gap-4 border-b border-[var(--color-surface-border)] px-4 py-3 last:border-b-0"
        >
          {columnWidths.map((w, j) => (
            <Row key={j} width={w} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Composed skeleton: `<Skeleton.Row />`, `<Skeleton.Table />`. */
export const Skeleton = {
  Row,
  Table: TableSkeleton,
};

/** Convenience: bare div the same shape as a skeleton row but accepting children
 *  (for inline shimmer inside a custom layout). */
export function Shimmer({ children }: { children?: ReactNode }): JSX.Element {
  return (
    <div className="animate-pulse rounded bg-[var(--color-surface-muted)]">{children}</div>
  );
}
