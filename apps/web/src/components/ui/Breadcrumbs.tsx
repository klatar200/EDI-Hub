/**
 * UI Phase U2/N5 — Breadcrumbs primitive.
 *
 * Replaces the per-page "back arrow + parent name" link with a real
 * breadcrumb trail so users always have an "up" path. The last item is
 * the current page; everything before it is a link.
 *
 *   <Breadcrumbs items={[
 *     { to: '/lifecycles', label: 'Lifecycles' },
 *     { label: 'PO-12345' },        // current page — no `to`
 *   ]} />
 *
 * Rendered as a semantic <nav aria-label="Breadcrumb"><ol>…</ol></nav>
 * so screen readers announce it as a single breadcrumb landmark. The
 * current page is marked with `aria-current="page"`. A back chevron sits
 * before the first link to keep the visual affordance the old back-link
 * provided.
 */
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export interface BreadcrumbItem {
  /** Route to navigate to. Omit on the LAST item — that's the current page. */
  to?: string;
  /** Display label. Strings are fine; pass a ReactNode if you need styled
   *  segments (e.g. monospace identifiers). */
  label: ReactNode;
  /** Optional testid for the rendered <Link> or <span>. */
  testId?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  /** Extra classes — useful for `print:hidden` on print-friendly pages. */
  className?: string;
}

function Separator(): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-3 w-3 shrink-0 text-[var(--color-fg-subtle)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function BackChevron(): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function Breadcrumbs({ items, className = '' }: BreadcrumbsProps): JSX.Element {
  if (items.length === 0) return <></>;
  const lastIndex = items.length - 1;
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, i) => {
          const isLast = i === lastIndex;
          // First link is the natural "back" target — pair it with a
          // chevron-left so the visual affordance from the old single
          // back-link survives the change.
          const isFirstLink = i === 0 && !isLast;
          if (isLast) {
            return (
              <li
                key={i}
                aria-current="page"
                data-testid={item.testId}
                className="inline-flex items-center gap-1.5 font-medium text-[var(--color-fg)]"
              >
                {/* Only render a separator before the current page when there's
                    a parent — single-item breadcrumbs (rare) skip it. */}
                {i > 0 ? <Separator /> : null}
                <span className="truncate">{item.label}</span>
              </li>
            );
          }
          if (!item.to) {
            // Non-current item without a `to` is a logical error from the
            // caller, but degrade gracefully to plain text rather than throw.
            return (
              <li key={i} className="inline-flex items-center gap-1.5 text-[var(--color-fg-muted)]">
                {i > 0 ? <Separator /> : null}
                <span>{item.label}</span>
              </li>
            );
          }
          return (
            <li key={i} className="inline-flex items-center gap-1.5">
              {i > 0 ? <Separator /> : null}
              <Link
                to={item.to}
                data-testid={item.testId}
                className="inline-flex items-center gap-1 rounded text-[var(--color-fg-muted)] transition hover:text-[var(--color-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30"
              >
                {isFirstLink ? <BackChevron /> : null}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
