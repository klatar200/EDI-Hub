/**
 * UI Phase Sprint 2.2 — Skeleton loaders.
 *
 * Token-aware replacement for the old slate-based skeleton. Flavors:
 *   - <Skeleton.Row /> — single shimmer bar
 *   - <Skeleton.Table /> — table placeholder (matches DataTable row height)
 *   - <Skeleton.CardStack /> — mobile card list placeholder
 *   - <Skeleton.List /> — responsive list: cards below lg, table at lg+
 *
 * UR7/R59 — row padding and card heights tuned to reduce layout shift.
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
      <div className="flex gap-4 border-b border-[var(--color-surface-border)] bg-[var(--color-surface-muted)]/40 px-4 py-2.5">
        {columnWidths.map((w, j) => (
          <Row key={`h-${j}`} width={w} height="h-3" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex min-h-[2.625rem] items-center gap-4 border-b border-[var(--color-surface-border)] px-4 py-2.5 last:border-b-0"
        >
          {columnWidths.map((w, j) => (
            <Row key={j} width={w} />
          ))}
        </div>
      ))}
    </div>
  );
}

interface CardStackProps {
  count?: number;
}

/** Matches MobileTableCards card shape (Card p-3, space-y-2). */
function CardStackSkeleton({ count = 4 }: CardStackProps): JSX.Element {
  return (
    <ul
      className="space-y-2"
      role="status"
      aria-busy="true"
      aria-label="Loading content"
      data-testid="skeleton-card-stack"
    >
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] p-3 shadow-xs"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <Row width="45%" height="h-4" />
            <Row width="3.5rem" height="h-5" className="rounded-full" />
          </div>
          <Row width="72%" height="h-3" className="mb-1.5" />
          <Row width="52%" height="h-3" />
        </li>
      ))}
    </ul>
  );
}

interface ListProps {
  rows?: number;
  columnWidths?: string[];
}

/** Responsive list skeleton — cards below `lg`, table at `lg+`. */
function ListSkeleton({
  rows = 6,
  columnWidths = ['40%', '24%', '20%', '20%', '16%'],
}: ListProps): JSX.Element {
  return (
    <>
      <div className="lg:hidden">
        <CardStackSkeleton count={Math.min(rows, 6)} />
      </div>
      <div className="hidden lg:block">
        <TableSkeleton rows={rows} columnWidths={columnWidths} />
      </div>
    </>
  );
}

/** Composed skeleton: `<Skeleton.Row />`, `<Skeleton.Table />`, etc. */
export const Skeleton = {
  Row,
  Table: TableSkeleton,
  CardStack: CardStackSkeleton,
  List: ListSkeleton,
};

/** Convenience: bare div the same shape as a skeleton row but accepting children
 *  (for inline shimmer inside a custom layout). */
export function Shimmer({ children }: { children?: ReactNode }): JSX.Element {
  return (
    <div className="animate-pulse rounded bg-[var(--color-surface-muted)]">{children}</div>
  );
}
