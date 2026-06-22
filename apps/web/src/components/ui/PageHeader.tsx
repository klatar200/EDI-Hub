/**
 * UI Phase Sprint 1.4 — PageHeader primitive.
 *
 * Every page renders with the same vertical rhythm: title (h1), optional
 * subtitle, optional action slot on the right. Replaces the ad-hoc
 * `<h1 className="...">` patterns scattered across pages.
 *
 * Usage:
 *   <PageHeader
 *     title="Transactions"
 *     subtitle="Every decoded EDI transaction across your trading partners."
 *     actions={<button className="btn-primary">Ingest file</button>}
 *   />
 */
import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Title is typed as ReactNode so callers can render a styled treatment
   *  (e.g. "Lifecycle · PO-12345" with the PO in monospace). Most pages
   *  pass a plain string. */
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned action slot — buttons, filters, links. */
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps): JSX.Element {
  return (
    <div className="mb-6 flex items-start justify-between gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-fg)]">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
