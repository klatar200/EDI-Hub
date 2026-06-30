import { useLayoutEffect, type RefObject } from 'react';

/** UR0/R9 — keep `--header-height` in sync with the sticky layout header
 *  so DataTable sticky thead offsets correctly when the header wraps. */
export function useSyncHeaderHeight(headerRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    const root = document.documentElement;
    const sync = (): void => {
      root.style.setProperty('--header-height', `${el.getBoundingClientRect().height}px`);
    };

    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [headerRef]);
}
