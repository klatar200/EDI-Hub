/**
 * UI Phase Sprint 4.3 — Toast notifications.
 *
 * Lightweight in-house toast queue. Provider mounts once at the root;
 * `useToast()` returns a typed dispatcher with shorthand variants:
 *
 *   const toast = useToast();
 *   toast.success('Partner saved');
 *   toast.error('Save failed', { description: err.message });
 *
 * Toasts auto-dismiss after `defaultDuration` (5s) unless `duration` is
 * overridden per-call or set to 0 (sticky). Click anywhere on the toast
 * to dismiss early.
 *
 * Rendered in a fixed bottom-right viewport. No portal — Tailwind's
 * `fixed` + `z-50` keeps the toast above page chrome already.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastTone = 'success' | 'error' | 'info' | 'warn';

interface ToastBase {
  title: ReactNode;
  description?: ReactNode;
  /** Milliseconds before auto-dismiss. Default 5000. 0 = sticky. */
  duration?: number;
}

interface Toast extends ToastBase {
  id: string;
  tone: ToastTone;
}

interface ToastDispatcher {
  show: (tone: ToastTone, payload: ToastBase) => void;
  success: (title: ReactNode, opts?: Omit<ToastBase, 'title'>) => void;
  error:   (title: ReactNode, opts?: Omit<ToastBase, 'title'>) => void;
  info:    (title: ReactNode, opts?: Omit<ToastBase, 'title'>) => void;
  warn:    (title: ReactNode, opts?: Omit<ToastBase, 'title'>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastDispatcher | null>(null);

/** Token color block per tone — kept inline rather than a sub-component so the
 *  viewport JSX stays scannable. */
const TONE_STYLES: Record<ToastTone, string> = {
  success: 'border-[var(--color-success-500)]/30 bg-[var(--color-success-50)] text-[var(--color-success-700)]',
  error:   'border-[var(--color-error-500)]/30   bg-[var(--color-error-50)]   text-[var(--color-error-700)]',
  info:    'border-[var(--color-info-500)]/30    bg-[var(--color-info-50)]    text-[var(--color-info-700)]',
  warn:    'border-[var(--color-warn-500)]/30    bg-[var(--color-warn-50)]    text-[var(--color-warn-700)]',
};

const TONE_ICON: Record<ToastTone, JSX.Element> = {
  success: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5" /></svg>,
  error:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>,
  info:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>,
  warn:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
};

interface ToastProviderProps {
  defaultDuration?: number;
  children: ReactNode;
}

export function ToastProvider({ defaultDuration = 5000, children }: ToastProviderProps): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (tone: ToastTone, payload: ToastBase) => {
      seq.current += 1;
      const id = `t-${seq.current}`;
      setToasts((prev) => [...prev, { id, tone, ...payload }]);
      const duration = payload.duration ?? defaultDuration;
      if (duration > 0) {
        // Defer the auto-dismiss so the React render commits before the timer
        // could fire — avoids "double-dismiss" warnings under StrictMode.
        setTimeout(() => dismiss(id), duration);
      }
    },
    [defaultDuration, dismiss],
  );

  const dispatch = useMemo<ToastDispatcher>(
    () => ({
      show,
      success: (title, opts) => show('success', { title, ...(opts ?? {}) }),
      error:   (title, opts) => show('error',   { title, ...(opts ?? {}) }),
      info:    (title, opts) => show('info',    { title, ...(opts ?? {}) }),
      warn:    (title, opts) => show('warn',    { title, ...(opts ?? {}) }),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={dispatch}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}): JSX.Element {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }): JSX.Element {
  // Slight slide-in feel. Tailwind v4 supports `animate-in` via JIT if the
  // utility plugin is available; we hand-roll a minimal opacity transition.
  return (
    <button
      type="button"
      onClick={onDismiss}
      data-testid={`toast-${toast.tone}`}
      className={`pointer-events-auto flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left text-sm shadow-md ${TONE_STYLES[toast.tone]}`}
    >
      <span className="mt-0.5 shrink-0">{TONE_ICON[toast.tone]}</span>
      <div className="flex-1">
        <div className="font-semibold">{toast.title}</div>
        {toast.description ? <div className="mt-0.5 text-xs opacity-80">{toast.description}</div> : null}
      </div>
    </button>
  );
}

export function useToast(): ToastDispatcher {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // No-op dispatcher when used outside a provider (storybook / isolated tests).
    // Components that genuinely need toast feedback should rely on ToastProvider
    // at the root; this fallback prevents crashes.
    const noop: ToastDispatcher = {
      show: () => undefined,
      success: () => undefined,
      error:   () => undefined,
      info:    () => undefined,
      warn:    () => undefined,
      dismiss: () => undefined,
    };
    return noop;
  }
  return ctx;
}

