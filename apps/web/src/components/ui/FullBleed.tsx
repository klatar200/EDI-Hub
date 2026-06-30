/**
 * UR5/R4 — opt-in viewport-width section while page chrome stays constrained.
 */
import type { ReactNode } from 'react';

export function FullBleed({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={`full-bleed ${className}`} data-testid="full-bleed">
      {children}
    </div>
  );
}
