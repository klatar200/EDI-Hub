/**
 * UR1/R8 — mobile navigation drawer (replaces `<details>` hamburger).
 */
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { RequireRole } from '../lib/useRole.tsx';
import { Sheet } from './ui/Sheet.tsx';

export interface MobileNavItem {
  to: string;
  label: string;
  end?: boolean;
  badge?: number;
  adminOnly?: boolean;
  testId?: string;
}

interface MobileNavDrawerProps {
  monitorNav: MobileNavItem[];
  exploreNav: MobileNavItem[];
  configureNav: MobileNavItem[];
}

const inactiveClass =
  'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)]';
const activeClass = 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]';

function mobileNavClass({ isActive }: { isActive: boolean }): string {
  return `flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition ${
    isActive ? activeClass : inactiveClass
  }`;
}

function MobileNavLink({
  item,
  onNavigate,
}: {
  item: MobileNavItem;
  onNavigate: () => void;
}): JSX.Element {
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      className={mobileNavClass}
      data-testid={item.testId}
      onClick={onNavigate}
    >
      <span className="flex-1">{item.label}</span>
      {item.badge && item.badge > 0 ? (
        <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--color-error-500)] px-1.5 text-[10px] font-bold text-white">
          {item.badge}
        </span>
      ) : null}
    </NavLink>
  );
  return item.adminOnly ? <RequireRole role="admin">{link}</RequireRole> : link;
}

function NavSection({
  title,
  items,
  onNavigate,
}: {
  title: string;
  items: MobileNavItem[];
  onNavigate: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)]">
        {title}
      </span>
      {items.map((item) => (
        <MobileNavLink key={item.to} item={item} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

export function MobileNavDrawer({
  monitorNav,
  exploreNav,
  configureNav,
}: MobileNavDrawerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const close = (): void => setOpen(false);

  return (
    <>
      <button
        type="button"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30 lg:hidden"
        aria-label="Open navigation menu"
        aria-expanded={open}
        data-testid="mobile-nav-toggle"
        onClick={() => setOpen(true)}
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
          <path d="M3 5h14a1 1 0 0 1 0 2H3a1 1 0 1 1 0-2Zm0 4h14a1 1 0 0 1 0 2H3a1 1 0 1 1 0-2Zm0 4h14a1 1 0 0 1 0 2H3a1 1 0 1 1 0-2Z" />
        </svg>
      </button>
      <Sheet open={open} onClose={close} title="Navigation" side="right">
        <div className="flex flex-col gap-4" data-testid="mobile-nav-panel">
          <NavSection title="Monitor" items={monitorNav} onNavigate={close} />
          <NavSection title="Explore" items={exploreNav} onNavigate={close} />
          <NavSection title="Configure" items={configureNav} onNavigate={close} />
        </div>
      </Sheet>
    </>
  );
}
