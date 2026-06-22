/**
 * UI Phase Sprint 1 — Status pill primitive.
 *
 * One component everywhere we show a status badge: RawFile status,
 * Alert severity, transaction direction, channel health, etc.
 * Variants map to the four status token sets registered in index.css.
 *
 * Usage:
 *   <StatusPill tone="success">PARSED</StatusPill>
 *   <StatusPill tone="error">REJECTED</StatusPill>
 *   <StatusPill tone="warn"  size="sm">Stale</StatusPill>
 */
import type { ReactNode } from 'react';

export type StatusTone = 'neutral' | 'success' | 'warn' | 'error' | 'info' | 'brand';
export type StatusSize = 'sm' | 'md';

const toneClasses: Record<StatusTone, string> = {
  neutral: 'bg-[var(--color-surface-muted)] text-[var(--color-fg-muted)] ring-[var(--color-surface-border)]',
  success: 'bg-[var(--color-success-50)]    text-[var(--color-success-700)] ring-[var(--color-success-500)]/20',
  warn:    'bg-[var(--color-warn-50)]       text-[var(--color-warn-700)]    ring-[var(--color-warn-500)]/30',
  error:   'bg-[var(--color-error-50)]      text-[var(--color-error-700)]   ring-[var(--color-error-500)]/25',
  info:    'bg-[var(--color-info-50)]       text-[var(--color-info-700)]    ring-[var(--color-info-500)]/20',
  brand:   'bg-[var(--color-brand-50)]      text-[var(--color-brand-700)]   ring-[var(--color-brand-500)]/20',
};

const sizeClasses: Record<StatusSize, string> = {
  sm: 'px-1.5 py-0.5 text-[11px] font-medium',
  md: 'px-2   py-0.5 text-xs    font-medium',
};

interface StatusPillProps {
  tone?: StatusTone;
  size?: StatusSize;
  /** Optional dot indicator on the left — useful when the tone alone is
   *  the signal and the label is supplementary. */
  withDot?: boolean;
  children: ReactNode;
}

export function StatusPill({
  tone = 'neutral',
  size = 'md',
  withDot = false,
  children,
}: StatusPillProps): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full ring-1 ring-inset whitespace-nowrap ${toneClasses[tone]} ${sizeClasses[size]}`}
    >
      {withDot ? (
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            tone === 'success' ? 'bg-[var(--color-success-500)]'
            : tone === 'warn'  ? 'bg-[var(--color-warn-500)]'
            : tone === 'error' ? 'bg-[var(--color-error-500)]'
            : tone === 'info'  ? 'bg-[var(--color-info-500)]'
            : tone === 'brand' ? 'bg-[var(--color-brand-500)]'
            : 'bg-[var(--color-fg-subtle)]'
          }`}
        />
      ) : null}
      {children}
    </span>
  );
}

/** Convenience: classify a RawFileStatus enum into a tone. Use across
 *  Transactions, Ingestions, Raw file detail pages. */
export function rawFileTone(status: string | null | undefined): StatusTone {
  switch (status) {
    case 'PARSED':              return 'success';
    case 'RECEIVED':            return 'info';
    case 'DUPLICATE':           return 'neutral';
    case 'PARSE_ERROR':         return 'error';
    case 'UNRECOGNIZED_FORMAT': return 'error';
    case 'FAILED':              return 'error';
    case 'ARCHIVED':            return 'neutral';
    default:                    return 'neutral';
  }
}
