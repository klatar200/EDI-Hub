/**
 * UI Phase Sprint 2.2 — ErrorState primitive.
 *
 * Used when a query fails. Distinct from EmptyState (which means "nothing
 * to show, that's expected") — ErrorState means "something went wrong,
 * here's the next action".
 *
 * Usage:
 *   {q.isError && (
 *     <ErrorState
 *       title="Could not load transactions"
 *       description="The API isn't responding. Verify the server is running."
 *       action={<button className="btn" onClick={() => q.refetch()}>Retry</button>}
 *     />
 *   )}
 */
import type { ReactNode } from 'react';

interface ErrorStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function ErrorState({ title, description, action }: ErrorStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--color-error-500)]/30 bg-[var(--color-error-50)] px-6 py-10 text-center">
      <div
        className="mb-2 grid h-8 w-8 place-items-center rounded-full bg-[var(--color-error-500)]/15 text-[var(--color-error-700)]"
        aria-hidden
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-[var(--color-error-700)]">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-[var(--color-error-700)]/85">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
