/**
 * UR3/R25 — primary filters inline; secondary filters in a popover below `md`.
 */
import type { ReactNode } from 'react';
import { useMaxMd } from '../../lib/useMediaQuery.ts';
import { Popover } from './Popover.tsx';

export interface FilterToolbarProps {
  /** Always visible (primary / tab pivots). */
  inline: ReactNode;
  /** Shown inline at `md+`; collapsed into Filters popover below `md`. */
  secondary: ReactNode;
  activeSecondaryCount?: number;
  trailing?: ReactNode;
  className?: string;
}

export function FilterToolbar({
  inline,
  secondary,
  activeSecondaryCount = 0,
  trailing,
  className = '',
}: FilterToolbarProps): JSX.Element {
  const narrow = useMaxMd();

  return (
    <div className={`flex flex-wrap items-end justify-between gap-3 ${className}`}>
      <div className="flex flex-wrap items-end gap-3">
        {inline}
        {narrow ? (
          <Popover>
            <Popover.Trigger asChild>
              <button
                type="button"
                data-testid="filters-popover-trigger"
                aria-label={`Filters${activeSecondaryCount > 0 ? ` (${activeSecondaryCount} active)` : ''}`}
                className="inline-flex items-center gap-2 self-end rounded-md border border-[var(--color-surface-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30 data-[state=open]:bg-[var(--color-surface-muted)] data-[state=open]:text-[var(--color-fg)]"
              >
                <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                  <path d="M3 4h14a1 1 0 0 1 .8 1.6L12 12v4a1 1 0 0 1-1.45.9l-2-1A1 1 0 0 1 8 15v-3L2.2 5.6A1 1 0 0 1 3 4Z" />
                </svg>
                Filters
                {activeSecondaryCount > 0 ? (
                  <span
                    data-testid="filters-active-count"
                    className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--color-brand-500)] px-1 text-[10px] font-bold leading-none text-white"
                  >
                    {activeSecondaryCount}
                  </span>
                ) : null}
              </button>
            </Popover.Trigger>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="w-[min(640px,90vw)] container-panel"
              data-testid="filters-popover"
            >
              <div className="filter-panel-grid">{secondary}</div>
            </Popover.Content>
          </Popover>
        ) : (
          secondary
        )}
      </div>
      {trailing}
    </div>
  );
}
