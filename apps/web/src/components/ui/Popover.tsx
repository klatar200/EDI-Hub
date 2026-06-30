/**
 * UI Phase U0/U1 — Popover primitive (Radix-backed).
 *
 * Thin wrapper over `@radix-ui/react-popover` that bakes in the project's
 * surface tokens, radius, border, and shadow. Re-exports the Radix parts so
 * callers can compose anchors, arrows, or controlled state when needed:
 *
 *   <Popover>
 *     <Popover.Trigger asChild><button className="btn">Filters</button></Popover.Trigger>
 *     <Popover.Content align="start">
 *       <p>…filter body…</p>
 *     </Popover.Content>
 *   </Popover>
 *
 * The `Content` wrapper portals to <body>, closes on Escape and outside
 * click for free, and styles itself with token vars so dark mode just works.
 */
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';

const Root = PopoverPrimitive.Root;
const Trigger = PopoverPrimitive.Trigger;
const Anchor = PopoverPrimitive.Anchor;
const Close = PopoverPrimitive.Close;
const Portal = PopoverPrimitive.Portal;

const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent(
  { className = '', align = 'start', sideOffset = 6, children, ...props },
  ref,
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={`z-50 max-h-[min(24rem,70dvh)] min-w-[12rem] overflow-y-auto rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] p-3 text-sm text-[var(--color-fg)] shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out ${className}`}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
});

interface PopoverComponent {
  (props: ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>): JSX.Element;
  Trigger: typeof Trigger;
  Anchor: typeof Anchor;
  Close: typeof Close;
  Portal: typeof Portal;
  Content: typeof PopoverContent;
}

export const Popover: PopoverComponent = (({ children, ...props }: { children: ReactNode }) => (
  <Root {...props}>{children}</Root>
)) as PopoverComponent;

Popover.Trigger = Trigger;
Popover.Anchor = Anchor;
Popover.Close = Close;
Popover.Portal = Portal;
Popover.Content = PopoverContent;
