/**
 * UR5/R34 — persistent left navigation at 2xl+.
 */
import { NavLink } from 'react-router-dom';
import { RequireRole } from '../lib/useRole.tsx';
import { SetupProgressIndicator } from './SetupProgressIndicator.tsx';
import type { MobileNavItem } from './MobileNavDrawer.tsx';

interface DesktopSidebarProps {
  monitorNav: MobileNavItem[];
  exploreNav: MobileNavItem[];
  configureNav: MobileNavItem[];
}

const inactiveClass =
  'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)]';
const activeClass = 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]';

function sidebarNavClass({ isActive }: { isActive: boolean }): string {
  return `flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
    isActive ? activeClass : inactiveClass
  }`;
}

function SidebarLink({
  item,
}: {
  item: MobileNavItem;
}): JSX.Element {
  const link = (
    <NavLink to={item.to} end={item.end} className={sidebarNavClass} data-testid={item.testId}>
      <span className="flex-1">{item.label}</span>
      {item.badge && item.badge > 0 ? (
        <span
          data-testid={item.label === 'Alerts' ? 'alerts-unread-badge' : undefined}
          className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--color-error-500)] px-1.5 text-[10px] font-bold text-white"
        >
          {item.badge}
        </span>
      ) : null}
    </NavLink>
  );
  return item.adminOnly ? <RequireRole role="admin">{link}</RequireRole> : link;
}

function SidebarSection({
  title,
  items,
}: {
  title: string;
  items: MobileNavItem[];
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)]">
        {title}
      </span>
      {items.map((item) => (
        <SidebarLink key={item.to} item={item} />
      ))}
    </div>
  );
}

export function DesktopSidebar({
  monitorNav,
  exploreNav,
  configureNav,
}: DesktopSidebarProps): JSX.Element {
  return (
    <aside
      className="sticky top-0 hidden h-svh w-56 shrink-0 flex-col border-r border-[var(--color-surface-border)] bg-[var(--color-surface-card)] 2xl:flex"
      data-testid="desktop-sidebar"
      aria-label="Application"
    >
      <div className="border-b border-[var(--color-surface-border)] px-4 py-4">
        <NavLink
          to="/"
          className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-[var(--color-fg)] hover:text-[var(--color-brand-700)]"
        >
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-md bg-[var(--color-brand-500)] text-[11px] font-bold leading-none text-white shadow-xs"
          >
            EH
          </span>
          EDI Hub
        </NavLink>
      </div>
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 py-4" aria-label="Primary">
        <SidebarSection title="Monitor" items={monitorNav} />
        <SidebarSection title="Explore" items={exploreNav} />
        <SidebarSection title="Configure" items={configureNav} />
      </nav>
      <div className="border-t border-[var(--color-surface-border)] px-4 py-3">
        <SetupProgressIndicator />
      </div>
    </aside>
  );
}
