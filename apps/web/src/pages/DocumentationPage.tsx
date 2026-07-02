/**
 * Documentation — in-app manual, organized by what the reader is trying to do.
 *
 * Layout intent: a first-time reader lands here. Give them
 *   (a) clear wayfinding — a wide sticky sidebar with grouped sections, a
 *       group → section breadcrumb, and a proper H1 per section so they
 *       always know where they are;
 *   (b) reading comfort — prose capped at ~72ch, generous padding on the
 *       content card, and typography sized for sustained reading (see
 *       DocBlocks.tsx);
 *   (c) linear flow — prev / next cards at the bottom, matching the order
 *       in DOC_SECTIONS, so a new user can just keep clicking Next.
 *
 * Section content lives in components/documentation/sections.tsx. Add new
 * sections there; the sidebar, breadcrumb, H1, and prev/next all update
 * automatically from the DOC_SECTIONS array.
 */
import { Link, useParams } from 'react-router-dom';
import { PageHeader, Card } from '../components/ui';
import {
  DOC_GROUPS,
  DOC_SECTIONS,
  DEFAULT_DOC_SECTION,
} from '../components/documentation/sections.tsx';

function ChevronRight(): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <path d="M4.5 3 7.5 6 4.5 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowLeft(): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <path d="M12.5 4 6.5 10l6 6M6.5 10h11" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowRight(): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <path d="M7.5 4l6 6-6 6M13.5 10h-11" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DocumentationPage(): JSX.Element {
  const { sectionId } = useParams();
  const active =
    DOC_SECTIONS.find((s) => s.id === sectionId) ??
    DOC_SECTIONS.find((s) => s.id === DEFAULT_DOC_SECTION) ??
    DOC_SECTIONS[0];

  const activeIndex = DOC_SECTIONS.findIndex((s) => s.id === active.id);
  const prev = activeIndex > 0 ? DOC_SECTIONS[activeIndex - 1] : null;
  const next =
    activeIndex >= 0 && activeIndex < DOC_SECTIONS.length - 1
      ? DOC_SECTIONS[activeIndex + 1]
      : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Documentation"
        subtitle="Written for the person opening EDI Hub for the first time. Start with Getting started and follow the sections in order, or jump to what you need from the menu."
      />

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        {/* Sticky section nav — wider than the app's primary nav on purpose,
             since section labels here read as full phrases, not single words. */}
        <nav
          aria-label="Documentation sections"
          className="lg:sticky lg:top-[calc(var(--header-height)+2rem)] lg:w-64 lg:shrink-0"
          data-testid="documentation-nav"
        >
          <Card className="p-3">
            {DOC_GROUPS.map((group, gi) => (
              <div key={group} className={gi === 0 ? '' : 'mt-4'}>
                <span className="block px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
                  {group}
                </span>
                <div className="flex flex-col gap-0.5">
                  {DOC_SECTIONS.filter((s) => s.group === group).map((s) => {
                    const isActive = s.id === active.id;
                    return (
                      <Link
                        key={s.id}
                        to={`/documentation/${s.id}`}
                        data-testid={`doc-nav-${s.id}`}
                        aria-current={isActive ? 'page' : undefined}
                        className={`rounded-md px-3 py-2 text-[15px] leading-tight transition ${
                          isActive
                            ? 'bg-[var(--color-brand-50)] font-semibold text-[var(--color-brand-700)]'
                            : 'font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)]'
                        }`}
                      >
                        {s.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </Card>
        </nav>

        {/* Content column. min-w-0 is important on flex children that host
             long-form content — without it, a stray un-breakable string in
             prose would push the whole flex row wider than the viewport. */}
        <div className="min-w-0 flex-1 space-y-6">
          <Card className="p-6 sm:p-10 lg:p-12" data-testid="documentation-content">
            {/* Group → section breadcrumb. Small, non-linked — just orientation. */}
            <nav
              aria-label="Breadcrumb"
              className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]"
            >
              <span>{active.group}</span>
              <ChevronRight />
              <span className="text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]">
                {active.label}
              </span>
            </nav>

            <h1 className="mb-8 text-3xl font-semibold tracking-tight text-[var(--color-fg)]">
              {active.label}
            </h1>

            {/* Cap prose at a readable measure. Callouts, field lists, and
                 step content all inherit this width — they don't need to run
                 to the container edge on wide screens. */}
            <div className="max-w-[72ch]">{active.content}</div>
          </Card>

          {/* Prev / next section cards — the primary way a first-time reader
              consumes docs. Rendered as a two-column grid so an empty prev
              (first section) still leaves next in the right slot. */}
          {(prev || next) && (
            <nav
              aria-label="Section navigation"
              className="grid gap-4 sm:grid-cols-2"
              data-testid="documentation-pager"
            >
              {prev ? (
                <Link
                  to={`/documentation/${prev.id}`}
                  data-testid={`doc-pager-prev-${prev.id}`}
                  className="group flex flex-col gap-1 rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] p-5 shadow-xs transition hover:border-[var(--color-brand-500)]/50 hover:bg-[var(--color-surface-muted)]/60 sm:col-start-1"
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
                    <ArrowLeft />
                    Previous
                  </span>
                  <span className="text-base font-semibold text-[var(--color-fg)] transition group-hover:text-[var(--color-brand-700)] dark:group-hover:text-[var(--color-brand-300)]">
                    {prev.label}
                  </span>
                  <span className="text-xs text-[var(--color-fg-subtle)]">{prev.group}</span>
                </Link>
              ) : (
                <div className="hidden sm:block" aria-hidden />
              )}
              {next ? (
                <Link
                  to={`/documentation/${next.id}`}
                  data-testid={`doc-pager-next-${next.id}`}
                  className="group flex flex-col items-end gap-1 rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] p-5 text-right shadow-xs transition hover:border-[var(--color-brand-500)]/50 hover:bg-[var(--color-surface-muted)]/60 sm:col-start-2"
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
                    Next
                    <ArrowRight />
                  </span>
                  <span className="text-base font-semibold text-[var(--color-fg)] transition group-hover:text-[var(--color-brand-700)] dark:group-hover:text-[var(--color-brand-300)]">
                    {next.label}
                  </span>
                  <span className="text-xs text-[var(--color-fg-subtle)]">{next.group}</span>
                </Link>
              ) : null}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
