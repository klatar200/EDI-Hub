/**
 * UI Phase Sprint 1.4 — EmptyState primitive.
 *
 * Shown when a table or list has nothing to render. Communicates BOTH
 * that the absence is intentional ("no rows yet" vs "load failed") AND
 * what the operator's next step is.
 *
 * Usage:
 *   <EmptyState
 *     title="No transactions yet"
 *     description="Once partners send EDI, decoded transactions appear here."
 *     action={<button className="btn-primary">Configure SFTP</button>}
 *   />
 */
import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** Accepts ReactNode so the legacy `<EmptyState>{copy}</EmptyState>`
   *  shim in components/states.tsx (which forwards children → title)
   *  type-checks. New callers should still pass a string for screen-
   *  reader friendliness. */
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Optional icon slot on top — typically a Lucide icon or SVG. */
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-surface-border)] bg-[var(--color-surface-card)] px-6 py-12 text-center">
      {icon ? (
        <div className="mb-3 text-[var(--color-fg-subtle)]" aria-hidden>
          {icon}
        </div>
      ) : null}
      <h3 className="text-sm font-semibold text-[var(--color-fg)]">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-[var(--color-fg-muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
