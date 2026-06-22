/**
 * UI Phase Sprint 4.2 — Modal (Dialog) primitive.
 *
 * Built on the native `<dialog>` element — gives us Escape-to-close,
 * focus trap, and inert-background semantics for free. Token-styled
 * backdrop + body. Three sizes (`sm` / `md` / `lg`).
 *
 *   <Modal open={open} onClose={() => setOpen(false)} title="Edit partner">
 *     <Modal.Body>… form …</Modal.Body>
 *     <Modal.Footer>
 *       <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
 *       <button className="btn-primary" onClick={save}>Save</button>
 *     </Modal.Footer>
 *   </Modal>
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

type Size = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<Size, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: Size;
  /** Hide the default close (×) button — caller is responsible for closing
   *  via its own footer button. Useful for confirmation dialogs that should
   *  not be dismissable by the X. */
  hideClose?: boolean;
  children: ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  hideClose = false,
  children,
}: ModalProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);

  // Sync the imperative <dialog> API with React state. `showModal()` is the
  // only way to get the inert-background + focus-trap behaviour; calling
  // `show()` would behave like a non-modal popover.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Native <dialog>'s `close` event fires on Esc + backdrop dismissal; wire
  // back to the React state via onClose.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCloseEvent = () => onClose();
    el.addEventListener('close', onCloseEvent);
    return () => el.removeEventListener('close', onCloseEvent);
  }, [onClose]);

  // Click on the backdrop (the dialog element itself, NOT its inner content)
  // closes the modal — standard expectation.
  function onBackdropClick(e: React.MouseEvent<HTMLDialogElement>): void {
    if (e.target === ref.current) onClose();
  }

  // Native <dialog opened via showModal()> is treated as a modal by AT,
  // so explicit role="dialog" / aria-modal isn't strictly required — but
  // we add them for older AT and for callers that wrap in a portal.
  return (
    <dialog
      ref={ref}
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
      className={`w-full ${SIZE_CLASS[size]} rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] p-0 text-[var(--color-fg)] shadow-lg backdrop:bg-black/40 backdrop:backdrop-blur-sm`}
    >
      {/* Header — title + close button. Suppress when no title AND
          hideClose so callers can render their own header. */}
      {(title || !hideClose) && (
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-surface-border)] px-5 py-3">
          {title ? <h2 className="text-sm font-semibold">{title}</h2> : <span />}
          {!hideClose ? (
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="grid h-6 w-6 place-items-center rounded text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          ) : null}
        </div>
      )}
      {children}
    </dialog>
  );
}

Modal.Body = function ModalBody({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
};

Modal.Footer = function ModalFooter({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      className={`flex items-center justify-end gap-2 border-t border-[var(--color-surface-border)] bg-[var(--color-surface-muted)]/30 px-5 py-3 ${className}`}
    >
      {children}
    </div>
  );
};
