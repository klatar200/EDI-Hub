/**
 * UI Phase U2/N5 — Breadcrumbs primitive.
 *
 * UR1/R12 — on narrow viewports, middle crumbs collapse to an ellipsis
 * (parent + current page stay visible).
 */
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useMaxMd } from '../../lib/useMediaQuery.ts';

export interface BreadcrumbItem {
  to?: string;
  label: ReactNode;
  testId?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
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

function labelText(label: ReactNode): string {
  return typeof label === 'string' ? label : '';
}

function CrumbLink({
  item,
  isFirstLink,
}: {
  item: BreadcrumbItem;
  isFirstLink: boolean;
}): JSX.Element {
  if (!item.to) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[var(--color-fg-muted)]">
        {item.label}
      </span>
    );
  }
  return (
    <Link
      to={item.to}
      data-testid={item.testId}
      className="inline-flex max-w-[10rem] items-center gap-1 truncate rounded text-[var(--color-fg-muted)] transition hover:text-[var(--color-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30 sm:max-w-none"
    >
      {isFirstLink ? <BackChevron /> : null}
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function CollapsedMiddle({ items }: { items: BreadcrumbItem[] }): JSX.Element {
  const description = items.map((i) => labelText(i.label)).filter(Boolean).join(' › ');
  return (
    <li className="inline-flex items-center gap-1.5 text-[var(--color-fg-subtle)]">
      <Separator />
      <span title={description} aria-label={description || 'Collapsed breadcrumbs'}>
        …
      </span>
    </li>
  );
}

export function Breadcrumbs({ items, className = '' }: BreadcrumbsProps): JSX.Element {
  const narrow = useMaxMd();
  if (items.length === 0) return <></>;

  const collapseMiddle = narrow && items.length > 2;
  const visibleItems: BreadcrumbItem[] = collapseMiddle
    ? [items[0]!, { label: '…' }, items[items.length - 1]!]
    : items;

  const lastIndex = visibleItems.length - 1;

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
        {collapseMiddle ? (
          <>
            <li className="inline-flex min-w-0 items-center gap-1.5">
              <CrumbLink item={items[0]!} isFirstLink={items.length > 1} />
            </li>
            <CollapsedMiddle items={items.slice(1, -1)} />
            <li
              aria-current="page"
              data-testid={items[lastIndex]!.testId}
              className="inline-flex min-w-0 items-center gap-1.5 font-medium text-[var(--color-fg)]"
            >
              <Separator />
              <span className="truncate">{items[lastIndex]!.label}</span>
            </li>
          </>
        ) : (
          visibleItems.map((item, i) => {
            const isLast = i === lastIndex;
            const isFirstLink = i === 0 && !isLast;
            if (isLast) {
              return (
                <li
                  key={i}
                  aria-current="page"
                  data-testid={item.testId}
                  className="inline-flex min-w-0 items-center gap-1.5 font-medium text-[var(--color-fg)]"
                >
                  {i > 0 ? <Separator /> : null}
                  <span className="truncate">{item.label}</span>
                </li>
              );
            }
            return (
              <li key={i} className="inline-flex min-w-0 items-center gap-1.5">
                {i > 0 ? <Separator /> : null}
                <CrumbLink item={item} isFirstLink={isFirstLink} />
              </li>
            );
          })
        )}
      </ol>
    </nav>
  );
}
