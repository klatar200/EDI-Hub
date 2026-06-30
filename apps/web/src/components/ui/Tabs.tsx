/**
 * UI Phase U2/FO1 — Tabs primitive.
 *
 * Lightweight tabs without a Radix dep (Popover and DropdownMenu carry
 * their weight, but Tabs are simple enough to roll our own). Implements
 * the WAI-ARIA Tabs pattern:
 *
 *   - `role="tablist"` on the trigger row, with horizontal arrow-key
 *     navigation and Home/End jumps.
 *   - `role="tab"` + `aria-selected` on each trigger, with `aria-controls`
 *     wired to the matching panel.
 *   - `role="tabpanel"` + `aria-labelledby` on each panel.
 *   - Roving tabindex: only the active tab is in the Tab order; arrow
 *     keys move focus between siblings (manual activation — Enter / Space
 *     selects, matching shadcn's default).
 *
 * Usage:
 *
 *   <Tabs value={tab} onValueChange={setTab}>
 *     <Tabs.List>
 *       <Tabs.Trigger value="identity">Identity</Tabs.Trigger>
 *       <Tabs.Trigger value="sets">Sets & flow</Tabs.Trigger>
 *     </Tabs.List>
 *     <Tabs.Panel value="identity">…fields…</Tabs.Panel>
 *     <Tabs.Panel value="sets">…fields…</Tabs.Panel>
 *   </Tabs>
 *
 * Inactive panels render `hidden` rather than being unmounted, so form
 * state (controlled inputs in each tab) survives a tab switch without the
 * parent having to lift every field. That's the whole point — splitting a
 * 9-section form into tabs shouldn't change the data model.
 */
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

interface TabsContextValue {
  /** Currently-selected tab value. */
  value: string;
  /** Switch tabs. */
  setValue: (next: string) => void;
  /** Stable id prefix so triggers + panels can pair via aria-controls. */
  baseId: string;
  /** Trigger refs keyed by value, for arrow-key focus management. */
  registerTrigger: (value: string, node: HTMLButtonElement | null) => void;
  /** Ordered list of registered trigger values, for arrow-key navigation. */
  triggerOrder: React.MutableRefObject<string[]>;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs.* must be rendered inside <Tabs>');
  return ctx;
}

interface TabsProps {
  value: string;
  onValueChange: (next: string) => void;
  className?: string;
  children: ReactNode;
}

export function Tabs({ value, onValueChange, className = '', children }: TabsProps): JSX.Element {
  const baseId = useId();
  const triggerOrder = useRef<string[]>([]);
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const registerTrigger = useCallback((v: string, node: HTMLButtonElement | null) => {
    if (node) {
      triggerRefs.current.set(v, node);
      if (!triggerOrder.current.includes(v)) {
        triggerOrder.current.push(v);
      }
    } else {
      triggerRefs.current.delete(v);
      triggerOrder.current = triggerOrder.current.filter((x) => x !== v);
    }
  }, []);

  const ctx = useMemo<TabsContextValue>(
    () => ({ value, setValue: onValueChange, baseId, registerTrigger, triggerOrder }),
    [value, onValueChange, baseId, registerTrigger],
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

interface TabsListProps {
  className?: string;
  /** Optional aria-label so screen readers describe the tablist's purpose
   *  (e.g. "Partner editor sections"). */
  ariaLabel?: string;
  children: ReactNode;
}

function TabsList({ className = '', ariaLabel, children }: TabsListProps): JSX.Element {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      className={`flex flex-wrap gap-1 border-b border-[var(--color-surface-border)] ${className}`}
    >
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  disabled?: boolean;
  className?: string;
  /** Optional testid forwarded to the rendered <button>. */
  testId?: string;
  children: ReactNode;
}

function TabsTrigger({ value, disabled, className = '', testId, children }: TabsTriggerProps): JSX.Element {
  const ctx = useTabsContext();
  const ref = useRef<HTMLButtonElement | null>(null);
  const setRef = useCallback(
    (node: HTMLButtonElement | null) => {
      ref.current = node;
      ctx.registerTrigger(value, node);
    },
    [ctx, value],
  );
  const isActive = ctx.value === value;

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    const order = ctx.triggerOrder.current;
    if (order.length === 0) return;
    const i = order.indexOf(value);
    if (i === -1) return;
    let next: string | null = null;
    switch (e.key) {
      case 'ArrowRight':
        next = order[(i + 1) % order.length] ?? null;
        break;
      case 'ArrowLeft':
        next = order[(i - 1 + order.length) % order.length] ?? null;
        break;
      case 'Home':
        next = order[0] ?? null;
        break;
      case 'End':
        next = order[order.length - 1] ?? null;
        break;
      default:
        return;
    }
    if (next) {
      e.preventDefault();
      ctx.setValue(next);
      // The newly-activated trigger needs focus so subsequent arrows
      // keep navigating from the active tab, not the previous one.
      requestAnimationFrame(() => {
        const node = document.getElementById(`${ctx.baseId}-trigger-${next}`);
        node?.focus();
      });
    }
  }

  return (
    <button
      ref={setRef}
      type="button"
      role="tab"
      id={`${ctx.baseId}-trigger-${value}`}
      aria-selected={isActive}
      aria-controls={`${ctx.baseId}-panel-${value}`}
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      data-testid={testId}
      data-state={isActive ? 'active' : 'inactive'}
      onClick={() => ctx.setValue(value)}
      onKeyDown={onKeyDown}
      className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30 focus:ring-offset-1 focus:ring-offset-[var(--color-surface-card)] disabled:cursor-not-allowed disabled:opacity-50 ${
        isActive
          ? 'border-[var(--color-brand-500)] text-[var(--color-brand-700)]'
          : 'border-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
      } ${className}`}
    >
      {children}
    </button>
  );
}

interface TabsPanelProps {
  value: string;
  className?: string;
  children: ReactNode;
}

function TabsPanel({ value, className = '', children }: TabsPanelProps): JSX.Element {
  const ctx = useTabsContext();
  const isActive = ctx.value === value;
  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${value}`}
      aria-labelledby={`${ctx.baseId}-trigger-${value}`}
      hidden={!isActive}
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  );
}

Tabs.List = TabsList;
Tabs.Trigger = TabsTrigger;
Tabs.Panel = TabsPanel;
