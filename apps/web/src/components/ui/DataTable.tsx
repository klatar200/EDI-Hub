/**
 * UI Phase Sprint 2.1 — DataTable primitive.
 *
 * Composable, token-aware table. Replaces the ad-hoc <Th>/<Td> helpers
 * each page rolls itself. Sticky header by default (so a long table
 * scrolls under the column labels), hover state on rows, optional zebra
 * striping, and a sort-indicator helper for sortable columns.
 *
 * Usage:
 *   <DataTable>
 *     <DataTable.Thead>
 *       <DataTable.Tr>
 *         <DataTable.Th sortable sortDirection="asc">Set</DataTable.Th>
 *         <DataTable.Th>PO</DataTable.Th>
 *       </DataTable.Tr>
 *     </DataTable.Thead>
 *     <DataTable.Tbody>
 *       <DataTable.Tr onClick={() => navigate(...)}>
 *         <DataTable.Td mono>850</DataTable.Td>
 *         <DataTable.Td>{row.po}</DataTable.Td>
 *       </DataTable.Tr>
 *     </DataTable.Tbody>
 *   </DataTable>
 */
import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes, HTMLAttributes } from 'react';

export type SortDirection = 'asc' | 'desc' | null;

interface DataTableProps {
  className?: string;
  /** When true, alternating rows get a subtle muted background. Off by default;
   *  the hover state usually gives enough row separation. */
  zebra?: boolean;
  children: ReactNode;
}

export function DataTable({ className = '', children }: DataTableProps): JSX.Element {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] shadow-xs ${className}`}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  );
}

DataTable.Thead = function Thead({ children }: { children: ReactNode }): JSX.Element {
  return (
    <thead className="sticky top-0 z-10 bg-[var(--color-surface-muted)]/95 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)] backdrop-blur">
      {children}
    </thead>
  );
};

DataTable.Tbody = function Tbody({
  zebra = false,
  children,
}: {
  zebra?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <tbody
      className={
        zebra
          ? '[&>tr:nth-child(even)]:bg-[var(--color-surface-muted)]/40'
          : ''
      }
    >
      {children}
    </tbody>
  );
};

interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  children: ReactNode;
}

DataTable.Tr = function Tr({ className = '', children, onClick, ...rest }: TrProps): JSX.Element {
  const clickable = typeof onClick === 'function';
  return (
    <tr
      className={`border-t border-[var(--color-surface-border)] transition first:border-t-0 ${
        clickable ? 'cursor-pointer hover:bg-[var(--color-surface-muted)]' : 'hover:bg-[var(--color-surface-muted)]/60'
      } ${className}`}
      onClick={onClick}
      {...rest}
    >
      {children}
    </tr>
  );
};

interface ThProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'children'> {
  sortable?: boolean;
  sortDirection?: SortDirection;
  /** Optional onClick when sortable; the chevron flips based on sortDirection. */
  onSort?: () => void;
  children: ReactNode;
}

DataTable.Th = function Th({
  sortable = false,
  sortDirection = null,
  onSort,
  className = '',
  children,
  ...rest
}: ThProps): JSX.Element {
  if (!sortable) {
    return (
      <th scope="col" className={`px-4 py-2.5 font-semibold ${className}`} {...rest}>
        {children}
      </th>
    );
  }
  // aria-sort needs "ascending" / "descending" / "none" to be useful to AT.
  const ariaSort =
    sortDirection === 'asc' ? 'ascending'
    : sortDirection === 'desc' ? 'descending'
    : 'none';
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-4 py-2.5 font-semibold ${className}`}
      {...rest}
    >
      <button
        type="button"
        onClick={onSort}
        className="inline-flex items-center gap-1 rounded transition hover:text-[var(--color-fg)]"
      >
        {children}
        <SortChevron direction={sortDirection} />
      </button>
    </th>
  );
};

interface TdProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'children'> {
  /** Render the value in JetBrains Mono — for control numbers, ISA ids,
   *  transaction set codes. */
  mono?: boolean;
  /** Subdue the cell color (timestamps, secondary metadata). */
  muted?: boolean;
  /** Right-align (numeric columns). */
  numeric?: boolean;
  children: ReactNode;
}

DataTable.Td = function Td({
  mono = false,
  muted = false,
  numeric = false,
  className = '',
  children,
  ...rest
}: TdProps): JSX.Element {
  return (
    <td
      className={`px-4 py-2.5 align-middle ${mono ? 'font-mono text-xs' : ''} ${
        muted ? 'text-[var(--color-fg-muted)]' : ''
      } ${numeric ? 'text-right tabular-nums' : ''} ${className}`}
      {...rest}
    >
      {children}
    </td>
  );
};

function SortChevron({ direction }: { direction: SortDirection }): JSX.Element {
  if (direction === null) {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-[var(--color-fg-subtle)]" aria-hidden>
        <path d="M7 14l5-5 5 5" opacity=".3" />
        <path d="M7 10l5 5 5-5" opacity=".3" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-[var(--color-brand-600)]" aria-hidden>
      {direction === 'asc'
        ? <path d="M7 14l5-5 5 5" />
        : <path d="M7 10l5 5 5-5" />}
    </svg>
  );
}
