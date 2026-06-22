/**
 * UI Phase Sprint 1.3 — Layout shell.
 *
 * Linear-style register: brand wordmark on the left, sectioned nav in the
 * middle, search + identity on the right. Active nav item gets a soft
 * brand-tinted background instead of a heavy "selected" bar.
 *
 * Header is `sticky top-0 z-30` so it persists while data tables scroll.
 * The page body is wrapped in a max-width container so multi-column
 * tables don't stretch on ultra-wide displays.
 */
import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { OrganizationSwitcher, UserButton } from '@clerk/react';
import { RequireRole } from '../lib/useRole.tsx';
import { api } from '../lib/api.ts';
import { SearchBox } from './SearchBox.tsx';
import { ThemeToggle } from './ui/ThemeToggle.tsx';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  badge?: number;
  adminOnly?: boolean;
  testId?: string;
}

const inactiveClass =
  'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)]';
const activeClass =
  'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]';

function navClass({ isActive }: { isActive: boolean }): string {
  // NavLink already sets `aria-current="page"` when isActive; the class
  // here just gives the visual treatment to match. Both signal "current"
  // to keyboard + screen-reader users.
  return `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition ${
    isActive ? activeClass : inactiveClass
  }`;
}

export function Layout(): JSX.Element {
  // Unread badge — refreshed every 30s; falls back silently when the API is down.
  const activeAlerts = useQuery({
    queryKey: ['alerts', 'active', 'unread-badge'],
    queryFn: () => api.alerts.list({ status: 'active' }),
    refetchInterval: 30_000,
    retry: false,
  });
  const unread = activeAlerts.data?.items.length ?? 0;

  const primaryNav: NavItem[] = [
    { to: '/', label: 'Transactions', end: true },
    { to: '/ingestions', label: 'Ingestions' },
    { to: '/metrics', label: 'Metrics' },
    { to: '/alerts', label: 'Alerts', badge: unread },
  ];

  const configNav: NavItem[] = [
    { to: '/partners-config', label: 'Partners' },
    { to: '/users', label: 'Users', adminOnly: true, testId: 'nav-users' },
  ];

  return (
    <div className="min-h-screen bg-[var(--color-surface-bg)] text-[var(--color-fg)]">
      <header className="sticky top-0 z-30 border-b border-[var(--color-surface-border)] bg-[var(--color-surface-card)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-6 py-2.5">
          {/* Brand wordmark — clickable home link */}
          <NavLink
            to="/"
            className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-[var(--color-fg)] hover:text-[var(--color-brand-700)]"
          >
            <span
              aria-hidden
              className="grid h-6 w-6 place-items-center rounded-md bg-[var(--color-brand-500)] text-[11px] font-bold leading-none text-white shadow-xs"
            >
              EH
            </span>
            EDI Hub
          </NavLink>

          {/* Primary nav */}
          <nav className="flex items-center gap-1">
            {primaryNav.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                {item.label}
                {item.badge && item.badge > 0 ? (
                  <span
                    data-testid={item.label === 'Alerts' ? 'alerts-unread-badge' : undefined}
                    className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--color-error-500)] px-1 text-[10px] font-bold leading-none text-white"
                  >
                    {item.badge}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </nav>

          {/* Divider before config nav */}
          <span aria-hidden className="h-5 w-px bg-[var(--color-surface-border)]" />

          <nav className="flex items-center gap-1">
            {configNav.map((item) => {
              const link = (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={navClass}
                  data-testid={item.testId}
                >
                  {item.label}
                </NavLink>
              );
              return item.adminOnly ? (
                <RequireRole key={item.to} role="admin">
                  {link}
                </RequireRole>
              ) : (
                link
              );
            })}
          </nav>

          {/* Search + identity on the right */}
          <div className="ml-auto flex items-center gap-3" data-testid="auth-controls">
            <SearchBox />
            <ThemeToggle />
            <span aria-hidden className="h-5 w-px bg-[var(--color-surface-border)]" />
            <OrganizationSwitcher
              hidePersonal
              afterSelectOrganizationUrl="/"
              appearance={{
                elements: {
                  organizationSwitcherTrigger:
                    'rounded-md px-2 py-1 text-sm hover:bg-[var(--color-surface-muted)]',
                },
              }}
            />
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
