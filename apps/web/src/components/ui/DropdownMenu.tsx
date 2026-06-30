/**
 * UI Phase U0/U1 — DropdownMenu primitive (Radix-backed).
 *
 * Thin wrapper over `@radix-ui/react-dropdown-menu` that bakes in the
 * project's tokens so the menu surface matches Card / Modal / Popover.
 *
 *   <DropdownMenu>
 *     <DropdownMenu.Trigger asChild><button>More</button></DropdownMenu.Trigger>
 *     <DropdownMenu.Content align="end">
 *       <DropdownMenu.Label>Configure</DropdownMenu.Label>
 *       <DropdownMenu.Item onSelect={() => navigate('/settings')}>Settings</DropdownMenu.Item>
 *       <DropdownMenu.Separator />
 *       <DropdownMenu.Item onSelect={signOut}>Sign out</DropdownMenu.Item>
 *     </DropdownMenu.Content>
 *   </DropdownMenu>
 *
 * Items support `asChild` so you can render a `react-router` <NavLink> and
 * keep client-side routing — important for the nav restructure.
 */
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';

const Root = DropdownMenuPrimitive.Root;
const Trigger = DropdownMenuPrimitive.Trigger;
const Portal = DropdownMenuPrimitive.Portal;
const Group = DropdownMenuPrimitive.Group;

const Content = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent(
  { className = '', align = 'start', sideOffset = 6, children, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={`z-50 min-w-[10rem] overflow-hidden rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] p-1 text-sm text-[var(--color-fg)] shadow-lg outline-none ${className}`}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
});

const Item = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(function DropdownMenuItem({ className = '', children, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={`relative flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm text-[var(--color-fg)] outline-none transition data-[highlighted]:bg-[var(--color-surface-muted)] data-[highlighted]:text-[var(--color-fg)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  );
});

const Label = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(function DropdownMenuLabel({ className = '', children, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Label
      ref={ref}
      className={`px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)] ${className}`}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Label>
  );
});

const Separator = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(function DropdownMenuSeparator({ className = '', ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      className={`my-1 h-px bg-[var(--color-surface-border)] ${className}`}
      {...props}
    />
  );
});

interface DropdownMenuComponent {
  (props: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>): JSX.Element;
  Trigger: typeof Trigger;
  Portal: typeof Portal;
  Group: typeof Group;
  Content: typeof Content;
  Item: typeof Item;
  Label: typeof Label;
  Separator: typeof Separator;
}

export const DropdownMenu: DropdownMenuComponent = (({ children, ...props }: { children: ReactNode }) => (
  <Root {...props}>{children}</Root>
)) as DropdownMenuComponent;

DropdownMenu.Trigger = Trigger;
DropdownMenu.Portal = Portal;
DropdownMenu.Group = Group;
DropdownMenu.Content = Content;
DropdownMenu.Item = Item;
DropdownMenu.Label = Label;
DropdownMenu.Separator = Separator;
