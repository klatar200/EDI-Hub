/**
 * UI Phase Sprint 2.3 — Pagination footer.
 *
 * The API's list endpoints return `{ items, limit, offset, count }` where
 * `count` is the page size, not the total (we don't have COUNT queries on
 * every list path yet). So this component shows the position by RANGE
 * rather than "Page 3 of 12":
 *
 *   "Showing 26–50 (25 results)"
 *
 * Disabled-prev when offset=0; disabled-next when count < limit (last
 * page). Same UX as the table-driven pagination on GitHub / Linear.
 */
interface PaginationProps {
  /** Current offset (0-indexed first row index). */
  offset: number;
  /** Page size requested. */
  limit: number;
  /** Number of rows actually returned in the current page (may be < limit
   *  on the last page). When equal to limit, we assume there's another
   *  page; when less, Next is disabled. */
  count: number;
  onChange: (nextOffset: number) => void;
  className?: string;
}

export function Pagination({
  offset,
  limit,
  count,
  onChange,
  className = '',
}: PaginationProps): JSX.Element | null {
  const showing = count > 0 ? `${offset + 1}–${offset + count}` : '0';
  const noPrev = offset === 0;
  const noNext = count < limit;

  if (offset === 0 && count === 0) return null;

  return (
    <div className={`mt-4 flex items-center justify-between text-sm ${className}`}>
      <p className="text-[var(--color-fg-muted)]">
        Showing <span className="font-medium tabular-nums text-[var(--color-fg)]">{showing}</span>
        {count > 0 ? <> &middot; <span className="tabular-nums">{count}</span> results</> : null}
      </p>
      <div className="flex items-center gap-1">
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
