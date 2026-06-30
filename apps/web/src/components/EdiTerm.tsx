/**
 * U5/O1 — inline EDI jargon tooltip for transaction set codes and acronyms.
 */
import type { ReactNode } from 'react';
import { lookupEdiGlossary } from '@edi/shared';
import { Tooltip, TooltipProvider } from './ui/Tooltip.tsx';

export function EdiTerm({
  term,
  children,
  className = '',
}: {
  term: string;
  children?: ReactNode;
  className?: string;
}): JSX.Element {
  const entry = lookupEdiGlossary(term);
  const label = children ?? term;

  if (!entry) {
    return <span className={className}>{label}</span>;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            data-testid={`edi-term-${entry.term}`}
            className={`inline-block cursor-help border-b border-dotted border-[var(--color-fg-subtle)] font-inherit text-inherit hover:border-[var(--color-brand-500)] focus:outline-none ${className}`}
            aria-label={`${entry.term}: ${entry.name}. ${entry.description}`}
          >
            {label}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content side="top" className="max-w-[16rem] space-y-1">
          <p className="font-semibold text-[var(--color-fg)]">
            <span className="font-mono">{entry.term}</span>
            {' — '}
            {entry.name}
          </p>
          <p className="text-[var(--color-fg-muted)] leading-snug">{entry.description}</p>
        </Tooltip.Content>
      </Tooltip>
    </TooltipProvider>
  );
}
