/**
 * UI Phase Sprint 1.4 — Card primitive.
 *
 * A neutral content container with the right surface tokens. Use for
 * grouping related content (a partner profile, an alert, a metric panel).
 * The `.card` utility in index.css does the same job for ad-hoc divs;
 * this component is the typed React entry point for new code.
 *
 * Sub-components mimic Linear / shadcn conventions (Card.Header, .Title,
 * .Content) so a future shadcn migration is mechanical, not redesign.
 */
import type { ReactNode } from 'react';

export function Card({
  className = '',
  children,
  id,
}: {
  className?: string;
  children: ReactNode;
  /** Optional DOM id — used for hash-scroll anchors (e.g. /settings#notifications). */
  id?: string;
}): JSX.Element {
  return (
    <div
      id={id}
      className={`rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] shadow-xs ${className}`}
    >
      {children}
    </div>
  );
}

Card.Header = function CardHeader({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={`flex items-start justify-between gap-4 border-b border-[var(--color-surface-border)] px-4 py-3 ${className}`}>
      {children}
    </div>
  );
};

Card.Title = function CardTitle({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <h2 className={`text-sm font-semibold text-[var(--color-fg)] ${className}`}>{children}</h2>
  );
};

Card.Description = function CardDescription({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <p className={`mt-0.5 text-xs text-[var(--color-fg-muted)] ${className}`}>{children}</p>
  );
};

Card.Content = function CardContent({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return <div className={`p-4 ${className}`}>{children}</div>;
};
