/**
 * Layout shell — grouped, responsive top navigation.
 *
 * Nav is organized into three intent-based groups so the hierarchy is legible
 * to a new user instead of 12 flat peers:
 *   - Monitor   (Lifecycles, Dashboard, Alerts)   — the day-to-day watch surface
 *   - Explore   (Transactions, Ingestions, Metrics) — drill into the raw data
 *   - Configure (Partners, Channels, Settings, Help, Users, Audit) — setup/admin
 *
 * Desktop (lg+): Monitor + Explore render inline (divider between); Configure
 * collapses into a labeled disclosure so the bar never overflows. Below lg the
 * whole nav collapses behind a single menu button. Both disclosures use native
 * <details> — no extra state, keyboard-accessible by default.
 *
 * Header is `sticky top-0 z-30` so it persists while data tables scroll.
 */
import type { MouseEvent } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { OrganizationSwitcher, UserButton } from '@clerk/react';
import { RequireRole, useApiReady } from '../lib/useRole.tsx';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { SearchBox } from './SearchBox.tsx';

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
const activeClass = 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]';

function navClass({ isActive }: { isActive: boolean }): string {
  // NavLink already sets `aria-current="page"` when isActive; the class here
  // just gives the visual treatment to match.
  return `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition ${
    isActive ? activeClass : inactiveClass
  }`;
}

function NavBadge({ count, label }: { count: number; label: string }): JSX.Element | null {
  if (!count || count <= 0) return null;
  return (
    <span
      data-testid={label === 'Alerts' ? 'alerts-unread-badge' : undefined}
      className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--color-error-500)] px-1 text-[10px] font-bold leading-none text-white"
    >
      {count}
    </span>
  );
}

/** Close the enclosing <details> after an in-panel navigation (SPA links
 * don't trigger a reload, so the disclosure would otherwise stay open). */
function closeEnclosingDetails(e: MouseEvent<HTMLElement>): void {
  const details = (e.target as HTMLElement).closest('details');
  if (details) details.removeAttribute('open');
}

function NavItemLink({ item }: { item: NavItem }): JSX.Element {
  const link = (
    <NavLink to={item.to} end={item.end} className={navClass} data-testid={item.testId}>
      {item.label}
      {item.badge ? <NavBadge count={item.badge} label={item.label} /> : null}
    </NavLink>
  );
  return item.adminOnly ? <RequireRole role="admin">{link}</RequireRole> : link;
}

const summaryClass =
  'flex cursor-pointer list-none items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)] [&::-webkit-details-marker]:hidden';

function Caret(): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className="h-3 w-3 transition-transform group-open:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Layout(): JSX.Element {
  const apiReady = useApiReady();
  // Unread badge — refreshed every 30s; falls back silently when the API is down.
  const alertsBadgeKey = useTenantQueryKey('alerts', 'active', 'unread-badge');
  const activeAlerts = useQuery({
    queryKey: alertsBadgeKey,
    queryFn: () => api.alerts.list({ status: 'active' }),
    refetchInterval: 30_000,
    retry: false,
    enabled: apiReady,
  });
  const unread = activeAlerts.data?.items.length ?? 0;

  const setupKey = useTenantQueryKey('setup');
  const setupQ = useQuery({
    queryKey: setupKey,
    queryFn: () => api.setup.get(),
    refetchInterval: 30_000,
    retry: false,
    enabled: apiReady,
  });
  const showDropBanner =
    setupQ.data?.desktopMode === true &&
    setupQ.data.firstRunComplete === true &&
    setupQ.data.hasIngested === false &&
    setupQ.data.dropFolderPath;

  const monitorNav: NavItem[] = [
    { to: '/lifecycles', label: 'Lifecycles' },
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/alerts', label: 'Alerts', badge: unread },
  ];
  const exploreNav: NavItem[] = [
    { to: '/transactions', label: 'Transactions' },
    { to: '/ingestions', label: 'Ingestions' },
    { to: '/metrics', label: 'Metrics' },
  ];
  const configureNav: NavItem[] = [
    { to: '/partners-config', label: 'Partners' },
    { to: '/channels', label: 'Channels' },
    { to: '/settings', label: 'Settings' },
    { to: '/help', label: 'Help' },
    { to: '/users', label: 'Users', adminOnly: true, testId: 'nav-users' },
    { to: '/admin/audit', label: 'Audit', adminOnly: true, testId: 'nav-audit' },
  ];

  const divider = <span aria-hidden className="h-5 w-px bg-[var(--color-surface-border)]" />;

  return (
    <div className="min-h-screen bg-[var(--color-surface-bg)] text-[var(--color-fg)]">
      <header className="sticky top-0 z-30 border-b border-[var(--color-surface-border)] bg-[var(--color-surface-card)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-6 py-2.5">
          {/* Brand wordmark — clickable home link */}
          <NavLink
            to="/"
            className="flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight text-[var(--color-fg)] hover:text-[var(--color-brand-700)]"
          >
            <span
              aria-hidden
              className="grid h-6 w-6 place-items-center rounded-md bg-[var(--color-brand-500)] text-[11px] font-bold leading-none text-white shadow-xs"
            >
              EH
            </span>
            EDI Hub
          </NavLink>

          {/* Desktop nav — grouped, hidden on small screens */}
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {monitorNav.map((item) => (
              <NavItemLink key={item.to} item={item} />
            ))}
            {divider}
            {exploreNav.map((item) => (
              <NavItemLink key={item.to} item={item} />
            ))}
            {divider}
            <details className="group relative">
              <summary className={summaryClass}>
                Configure
                <Caret />
              </summary>
              <div
                className="absolute left-0 z-40 mt-1 flex min-w-[160px] flex-col gap-0.5 rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] p-1 shadow-lg"
                onClick={closeEnclosingDetails}
              >
                {configureNav.map((item) => (
                  <NavItemLink key={item.to} item={item} />
                ))}
              </div>
            </details>
          </nav>

          {/* Search + identity on the right */}
          <div className="ml-auto flex items-center gap-3" data-testid="auth-controls">
            <SearchBox />
            <span aria-hidden className="hidden h-5 w-px bg-[var(--color-surface-border)] sm:block" />
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
            {/* `afterSignOutUrl` lives on ClerkProvider (main.tsx); the
                Clerk SDK removed it from UserButton in v0.x. */}
            <UserButton />
          </div>

          {/* Mobile nav — single disclosure holding every group, hidden on lg+ */}
          <details className="group relative lg:hidden">
            <summary
              className={`${summaryClass} px-2`}
              aria-label="Open navigation menu"
              data-testid="mobile-nav-toggle"
            >
              <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
                <path d="M3 5h14a1 1 0 0 1 0 2H3a1 1 0 1 1 0-2Zm0 4h14a1 1 0 0 1 0 2H3a1 1 0 1 1 0-2Zm0 4h14a1 1 0 0 1 0 2H3a1 1 0 1 1 0-2Z" />
              </svg>
            </summary>
            <div
              className="absolute right-0 z-40 mt-2 flex w-56 flex-col gap-3 rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] p-3 shadow-lg"
              onClick={closeEnclosingDetails}
            >
              <NavSection title="Monitor" items={monitorNav} />
              <NavSection title="Explore" items={exploreNav} />
              <NavSection title="Configure" items={configureNav} />
            </div>
          </details>
        </div>
      </header>

      {showDropBanner ? (
        <div
          className="border-b border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-6 py-2 text-center text-sm text-[var(--color-brand-800)]"
          data-testid="drop-folder-banner"
        >
          Drop an EDI file into{' '}
          <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs">
            {setupQ.data!.dropFolderPath}
          </code>{' '}
          to ingest it.
        </div>
      ) : null}

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}

function NavSection({ title, items }: { title: string; items: NavItem[] }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)]">
        {title}
      </span>
      {items.map((item) => (
        <NavItemLink key={item.to} item={item} />
      ))}
    </div>
  );
}
