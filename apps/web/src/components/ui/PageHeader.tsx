/**
 * UI Phase Sprint 1.4 — PageHeader primitive.
 *
 * UR1/R10 — stacks title above actions below `sm`; actions wrap instead of
 * forcing horizontal overflow on narrow viewports.
 */
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps): JSX.Element {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-fg)]">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
      ) : null}
    </div>
  );
}
