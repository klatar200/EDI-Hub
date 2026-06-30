/**
 * UR2/R13 — viewport hooks. Card vs table uses `lg` (1024px) so tablet
 * widths get cards instead of horizontal-scroll tables.
 */
import { useSyncExternalStore } from 'react';

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

function createMediaQueryHook(query: string, serverDefault: boolean) {
  function subscribe(onChange: () => void): () => void {
    if (!hasMatchMedia()) return () => {};
    const mq = window.matchMedia(query);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }

  function getSnapshot(): boolean {
    if (!hasMatchMedia()) return serverDefault;
    return window.matchMedia(query).matches;
  }

  return function useMatches(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, () => serverDefault);
  };
}

/** True below Tailwind `md` (max-width 767px). */
export const useMaxMd = createMediaQueryHook('(max-width: 767px)', false);

/** True below Tailwind `lg` (max-width 1023px). */
export const useMaxLg = createMediaQueryHook('(max-width: 1023px)', false);

/** List pages: card layout below `lg`, table at `lg+`. */
export function usePreferMobileCards(): boolean {
  return useMaxLg();
}
