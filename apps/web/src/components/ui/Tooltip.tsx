/**
 * U5/O1 — Radix Tooltip primitive (ADR 0003 / UI-2).
 */
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';

const Provider = TooltipPrimitive.Provider;
const Root = TooltipPrimitive.Root;
const Trigger = TooltipPrimitive.Trigger;

const TooltipContent = forwardRef<
  ElementRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent(
  { className = '', sideOffset = 4, children, ...props },
  ref,
) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={`z-50 max-w-xs rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] px-2.5 py-2 text-xs text-[var(--color-fg)] shadow-lg animate-in fade-in-0 zoom-in-95 ${className}`}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-[var(--color-surface-card)]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});

interface TooltipComponent {
  (props: ComponentPropsWithoutRef<typeof TooltipPrimitive.Root> & { children: ReactNode }): JSX.Element;
  Trigger: typeof Trigger;
  Content: typeof TooltipContent;
  Provider: typeof Provider;
}

export const Tooltip: TooltipComponent = (({
  children,
  delayDuration = 200,
  ...props
}: ComponentPropsWithoutRef<typeof TooltipPrimitive.Root> & { children: ReactNode }) => (
  <Root delayDuration={delayDuration} {...props}>
    {children}
  </Root>
)) as TooltipComponent;

Tooltip.Trigger = Trigger;
Tooltip.Content = TooltipContent;
Tooltip.Provider = Provider;

/** App-level provider — mount once near the root (main.tsx). */
export function TooltipProvider({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Provider delayDuration={200} skipDelayDuration={0}>
      {children}
    </Provider>
  );
}
