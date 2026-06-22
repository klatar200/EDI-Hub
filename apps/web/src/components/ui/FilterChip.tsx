/**
 * UI Phase Sprint 2.2 — Active filter chip.
 *
 * Rendered above a table to show what's currently filtering the result
 * set, with an `×` to remove. The pattern: pages keep their filter
 * state in URL search params, the chip's onRemove clears that param.
 *
 * Usage:
 *   <FilterChipRow>
 *     {filters.set     && <FilterChip label="Set"     value={filters.set}     onRemove={() => clear('set')} />}
 *     {filters.partner && <FilterChip label="Partner" value={filters.partner} onRemove={() => clear('partner')} />}
 *   </FilterChipRow>
 */
import type { ReactNode } from 'react';

interface FilterChipProps {
  /** Field label, shown subdued before the value. e.g. "Set". */
  label: string;
  /** The current filter value. */
  value: ReactNode;
  /** Removal handler — clears the underlying filter. */
  onRemove: () => void;
}

export function FilterChip({ label, value, onRemove }: FilterChipProps): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] py-0.5 pl-2 pr-1 text-xs">
      <span className="text-[var(--color-fg-subtle)]">{label}</span>
      <span className="font-medium text-[var(--color-fg)]">{value}</span>
      <button
        type="button"
        aria-label={`Remove ${label} filter`}
        onClick={onRemove}
        className="grid h-4 w-4 place-items-center rounded-full text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-card)] hover:text-[var(--color-fg)]"
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
          <path d="M6 6l12 12M18 6l-12 12" />
        </svg>
      </button>
    </span>
  );
}

interface FilterChipRowProps {
  children: ReactNode;
  /** Optional "Clear all" handler — renders a small clear button on the right
   *  when at least one chip is shown. */
  onClearAll?: () => void;
}

export function FilterChipRow({ children, onClearAll }: FilterChipRowProps): JSX.Element | null {
  // Filter out null/false/undefined children so empty <FilterChipRow> renders nothing.
  const items = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {items}
      {onClearAll ? (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-1 text-xs font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}
