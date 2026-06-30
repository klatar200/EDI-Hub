/**
 * UI Phase Sprint 2.1 — DataTable primitive.
 *
 * UR2 — horizontal scroll affordance; sticky header at `lg+` only (cards below).
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type ThHTMLAttributes,
  type TdHTMLAttributes,
  type HTMLAttributes,
} from 'react';

export type SortDirection = 'asc' | 'desc' | null;

interface DataTableContextValue {
  stickyHeader: boolean;
}

const DataTableContext = createContext<DataTableContextValue>({ stickyHeader: true });

interface DataTableProps {
  className?: string;
  density?: 'comfortable' | 'compact';
  zebra?: boolean;
  /** UR2/R45 — disable sticky thead (e.g. embedded mini-tables). Default true. */
  stickyHeader?: boolean;
  children: ReactNode;
}

function TableScrollRegion({ children }: { children: ReactNode }): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState({ left: false, right: false });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const sync = (): void => {
      const overflow = el.scrollWidth > el.clientWidth + 2;
      if (!overflow) {
        setHint({ left: false, right: false });
        return;
      }
      setHint({
        left: el.scrollLeft > 4,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      });
    };

    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="relative">
      {hint.left ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-8 bg-gradient-to-r from-[var(--color-surface-card)] to-transparent"
        />
      ) : null}
      {hint.right ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-8 bg-gradient-to-l from-[var(--color-surface-card)] to-transparent"
        />
      ) : null}
      <div ref={scrollRef} className="overflow-x-auto lg:overflow-x-visible">
        {children}
      </div>
    </div>
  );
}

export function DataTable({
  className = '',
  density = 'comfortable',
  stickyHeader = true,
  children,
}: DataTableProps): JSX.Element {
  const densityClass =
    density === 'compact'
      ? '[&_th]:px-3 [&_th]:py-1.5 [&_td]:px-3 [&_td]:py-1.5'
      : '';

  return (
    <DataTableContext.Provider value={{ stickyHeader }}>
      <div
        className={`overflow-clip rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] shadow-xs ${className}`}
        data-testid="data-table"
      >
        <TableScrollRegion>
          <table className={`w-full text-sm ${densityClass}`}>{children}</table>
        </TableScrollRegion>
      </div>
    </DataTableContext.Provider>
  );
}

DataTable.Thead = function Thead({ children }: { children: ReactNode }): JSX.Element {
  const { stickyHeader } = useContext(DataTableContext);
  const stickyClass = stickyHeader
    ? 'sticky top-[var(--header-height)] z-10 backdrop-blur'
    : '';
  return (
    <thead
      className={`bg-[var(--color-surface-muted)]/95 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)] ${stickyClass}`}
    >
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
  mono?: boolean;
  muted?: boolean;
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
