/**
 * Documentation — shared prose primitives.
 *
 * Small presentational building blocks so the actual documentation content
 * (components/documentation/sections.tsx) reads like content, not markup.
 * Keep these dumb and stylistic only — no data fetching, no routing logic.
 *
 * Sizing philosophy: docs are read in sustained passes, not scanned like a
 * table. Body copy is 16px / leading-7, headings scale up meaningfully, and
 * vertical spacing is generous. This is deliberately less compact than the
 * rest of the app UI.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function DocLead({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="mb-10 text-lg leading-8 text-[var(--color-fg-muted)]">{children}</p>
  );
}

export function DocH2({ children, id }: { children: ReactNode; id?: string }): JSX.Element {
  return (
    <h2
      id={id}
      className="mb-4 mt-14 scroll-mt-24 text-2xl font-semibold tracking-tight text-[var(--color-fg)] first:mt-0"
    >
      {children}
    </h2>
  );
}

export function DocH3({ children, id }: { children: ReactNode; id?: string }): JSX.Element {
  return (
    <h3
      id={id}
      className="mb-3 mt-10 scroll-mt-24 text-lg font-semibold text-[var(--color-fg)]"
    >
      {children}
    </h3>
  );
}

export function DocP({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="mb-5 text-base leading-7 text-[var(--color-fg)]">{children}</p>
  );
}

export function DocUl({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ul className="mb-6 ml-6 list-disc space-y-2.5 text-base leading-7 text-[var(--color-fg)] marker:text-[var(--color-fg-subtle)]">
      {children}
    </ul>
  );
}

export function DocCode({ children }: { children: ReactNode }): JSX.Element {
  // Font size is relative (0.9em) so inline <code> scales with whatever
  // text size surrounds it (body copy, heading, callout, step title).
  // Brand tokens stay constant across themes by design, so we swap to a
  // lighter brand shade in dark mode to keep contrast readable on the
  // dark surface-muted background.
  return (
    <code className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono text-[0.9em] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]">
      {children}
    </code>
  );
}

export function DocLink({ to, children }: { to: string; children: ReactNode }): JSX.Element {
  // Same brand-700 → brand-300 flip as DocCode. Underline decoration
  // matches the text color at 30–40% opacity so the underline follows the
  // theme automatically.
  return (
    <Link
      to={to}
      className="font-medium text-[var(--color-brand-600)] underline decoration-[var(--color-brand-600)]/30 underline-offset-2 transition hover:decoration-[var(--color-brand-600)] dark:text-[var(--color-brand-300)] dark:decoration-[var(--color-brand-300)]/40 dark:hover:decoration-[var(--color-brand-300)]"
    >
      {children}
    </Link>
  );
}

type CalloutKind = 'tip' | 'warning' | 'note';

// Note callouts intentionally use the info palette (blue) rather than the
// brand palette. Brand tokens don't have dark-mode overrides — brand-50 stays
// light in both themes — which would leave near-white body text on a light
// indigo background in dark mode. Info-50 and info-700 do have dark-mode
// overrides, so the note callout stays legible in both modes.
const CALLOUT_STYLES: Record<CalloutKind, string> = {
  tip: 'border-[var(--color-success-500)]/40 bg-[var(--color-success-50)]',
  warning: 'border-[var(--color-warn-500)]/40 bg-[var(--color-warn-50)]',
  note: 'border-[var(--color-info-500)]/40 bg-[var(--color-info-50)]',
};

const CALLOUT_LABEL_STYLES: Record<CalloutKind, string> = {
  tip: 'text-[var(--color-success-700)]',
  warning: 'text-[var(--color-warn-700)]',
  note: 'text-[var(--color-info-700)]',
};

const CALLOUT_LABELS: Record<CalloutKind, string> = {
  tip: 'Tip',
  warning: 'Heads up',
  note: 'Note',
};

const CALLOUT_ICONS: Record<CalloutKind, JSX.Element> = {
  tip: (
    <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M10 2v2M4.2 4.2l1.4 1.4M2 10h2M15.8 4.2l-1.4 1.4M18 10h-2" strokeLinecap="round" />
      <path d="M7 13.5a4 4 0 1 1 6 0v1.5a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 7 15v-1.5Z" />
      <path d="M8.5 18h3" strokeLinecap="round" />
    </svg>
  ),
  warning: (
    <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M10 2.5 1.5 17h17L10 2.5Z" strokeLinejoin="round" />
      <path d="M10 8v4M10 15v.5" strokeLinecap="round" />
    </svg>
  ),
  note: (
    <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v5M10 6.5v.5" strokeLinecap="round" />
    </svg>
  ),
};

export function DocCallout({
  kind = 'note',
  title,
  children,
}: {
  kind?: CalloutKind;
  title?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      className={`mb-6 rounded-lg border-l-4 border-y border-r px-5 py-4 ${CALLOUT_STYLES[kind]}`}
      role="note"
    >
      <div className={`mb-2 flex items-center gap-2 ${CALLOUT_LABEL_STYLES[kind]}`}>
        {CALLOUT_ICONS[kind]}
        <p className="text-xs font-semibold uppercase tracking-wide">
          {title ?? CALLOUT_LABELS[kind]}
        </p>
      </div>
      <div className="text-base leading-7 text-[var(--color-fg)]">{children}</div>
    </div>
  );
}

export function DocSteps({ children }: { children: ReactNode }): JSX.Element {
  return <ol className="mb-8 space-y-9">{children}</ol>;
}

export function DocStep({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <li className="relative pl-14">
      <span
        aria-hidden
        className="absolute left-0 top-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-brand-600)] text-sm font-bold leading-none text-white shadow-xs"
      >
        {n}
      </span>
      <p className="mb-2 text-lg font-semibold text-[var(--color-fg)]">{title}</p>
      <div className="text-base leading-7 text-[var(--color-fg-muted)]">{children}</div>
    </li>
  );
}

export interface DocField {
  field: string;
  description: ReactNode;
}

export function DocFieldList({ items }: { items: DocField[] }): JSX.Element {
  return (
    <dl className="mb-6 divide-y divide-[var(--color-surface-border)] overflow-hidden rounded-lg border border-[var(--color-surface-border)]">
      {items.map((it) => (
        <div
          key={it.field}
          className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,220px)_1fr] sm:gap-6"
        >
          <dt className="font-mono text-sm font-semibold text-[var(--color-fg)]">
            {it.field}
          </dt>
          <dd className="text-base leading-7 text-[var(--color-fg-muted)]">
            {it.description}
          </dd>
        </div>
      ))}
    </dl>
  );
}
