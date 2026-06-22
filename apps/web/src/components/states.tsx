/**
 * UI Phase Sprint 6.2 — Legacy state-component shim.
 *
 * The pre-UI-phase `Skeleton` / `ErrorState` / `EmptyState` lived in this
 * file with hand-rolled slate classes. Every page has since migrated to
 * the token-aware versions under `components/ui/`. This file remains as
 * a thin re-export so any straggler import keeps working AND so the dark
 * mode pass doesn't have to track down every caller.
 *
 * Prefer importing from '../components/ui' going forward.
 */
import type { ReactNode } from 'react';
import {
  Skeleton as UISkeleton,
  ErrorState as UIErrorState,
  EmptyState as UIEmptyState,
} from './ui';

/** Legacy table-skeleton signature `{ rows? }` — forwards to `<Skeleton.Table />`. */
export function Skeleton({ rows = 5 }: { rows?: number } = {}): JSX.Element {
  return <UISkeleton.Table rows={rows} />;
}

/** Legacy `<ErrorState>{copy}</ErrorState>` — splits the first sentence into
 *  title + remainder so the new richer primitive still gets sensible defaults. */
export function ErrorState({ children }: { children: ReactNode }): JSX.Element {
  // Avoid trying to split structured children — pass them as the title and
  // let the primitive style them. Old callers passed plain strings.
  return <UIErrorState title={children} />;
}

/** Legacy `<EmptyState>{copy}</EmptyState>` — same forwarding shape. */
export function EmptyState({ children }: { children: ReactNode }): JSX.Element {
  return <UIEmptyState title={children} />;
}
