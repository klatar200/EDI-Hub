/**
 * UI Phase Sprint 2.3 — Pagination footer.
 *
 * UR2/R41 — stacks on narrow viewports. R42 — optional sticky footer on mobile cards.
 */
interface PaginationProps {
  offset: number;
  limit: number;
  count: number;
  onChange: (nextOffset: number) => void;
  className?: string;
  /** Pin to bottom of viewport below `lg` (mobile card lists). */
  stickyMobile?: boolean;
}

export function Pagination({
  offset,
  limit,
  count,
  onChange,
  className = '',
  stickyMobile = false,
}: PaginationProps): JSX.Element | null {
  const showing = count > 0 ? `${offset + 1}–${offset + count}` : '0';
  const noPrev = offset === 0;
  const noNext = count < limit;

  if (offset === 0 && count === 0) return null;

  const stickyClass = stickyMobile
    ? 'max-lg:sticky max-lg:bottom-0 max-lg:z-10 max-lg:-mx-[var(--layout-gutter-x)] max-lg:border-t max-lg:border-[var(--color-surface-border)] max-lg:bg-[var(--color-surface-card)]/95 max-lg:px-[var(--layout-gutter-x)] max-lg:py-3 max-lg:backdrop-blur'
    : '';

  return (
    <div
      className={`mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 text-sm ${stickyClass} ${className}`}
      data-testid="pagination"
    >
      <p className="text-[var(--color-fg-muted)]">
        Showing <span className="font-medium tabular-nums text-[var(--color-fg)]">{showing}</span>
        {count > 0 ? <> &middot; <span className="tabular-nums">{count}</span> results</> : null}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          className="btn disabled:opacity-40"
          disabled={noPrev}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Previous
        </button>
        <button
          type="button"
          className="btn disabled:opacity-40"
          disabled={noNext}
          onClick={() => onChange(offset + limit)}
        >
          Next
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
