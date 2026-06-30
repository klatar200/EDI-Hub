/**
 * UR1/R8 — slide-over panel built on `<dialog>` (same focus trap as Modal).
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Which edge the panel slides from. */
  side?: 'left' | 'right';
  children: ReactNode;
}

export function Sheet({
  open,
  onClose,
  title,
  side = 'right',
  children,
}: SheetProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCloseEvent = () => onClose();
    el.addEventListener('close', onCloseEvent);
    return () => el.removeEventListener('close', onCloseEvent);
  }, [onClose]);

  function onBackdropClick(e: React.MouseEvent<HTMLDialogElement>): void {
    if (e.target === ref.current) onClose();
  }

  const sideClass =
    side === 'right'
      ? 'ml-auto h-full max-h-full w-[min(18rem,90vw)] border-l'
      : 'mr-auto h-full max-h-full w-[min(18rem,90vw)] border-r';

  return (
    <dialog
      ref={ref}
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : 'Panel'}
      className={`m-0 max-w-none rounded-none border-[var(--color-surface-border)] bg-[var(--color-surface-card)] p-0 text-[var(--color-fg)] shadow-lg backdrop:bg-black/40 backdrop:backdrop-blur-sm ${sideClass}`}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-surface-border)] px-4 py-3">
          {title ? <h2 className="text-sm font-semibold">{title}</h2> : <span />}
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">{children}</div>
      </div>
    </dialog>
  );
}
