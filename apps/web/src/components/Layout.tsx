/**
 * Layout shell — slim primary nav with overflow menu.
 *
 * UR1 — responsive header wrap, progressive chrome collapse, mobile nav drawer.
 */
import { useRef } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { OrganizationSwitcher, UserButton } from '@clerk/react';
import { RequireRole, useApiReady, useHasRole } from '../lib/useRole.tsx';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { useSyncHeaderHeight } from '../lib/useSyncHeaderHeight.ts';
import { SearchBox } from './SearchBox.tsx';
import { CommandPalette, useCommandPaletteHotkey } from './CommandPalette.tsx';
import { AlertBell } from './AlertBell.tsx';
import { SetupProgressIndicator } from './SetupProgressIndicator.tsx';
import { MobileNavDrawer } from './MobileNavDrawer.tsx';
import type { MobileNavItem } from './MobileNavDrawer.tsx';
import { DropdownMenu } from './ui';

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

function NavItemLink({ item }: { item: NavItem }): JSX.Element {
  const link = (
    <NavLink to={item.to} end={item.end} className={navClass} data-testid={item.testId}>
      {item.label}
      {item.badge ? <NavBadge count={item.badge} label={item.label} /> : null}
    </NavLink>
  );
  return item.adminOnly ? <RequireRole role="admin">{link}</RequireRole> : link;
}

const triggerClass =
  'inline-flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30 data-[state=open]:bg-[var(--color-surface-muted)] data-[state=open]:text-[var(--color-fg)]';

function Caret(): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Layout(): JSX.Element {
  const headerRef = useRef<HTMLElement>(null);
  useSyncHeaderHeight(headerRef);
  const apiReady = useApiReady();
  const navigate = useNavigate();
  const isAdmin = useHasRole('admin');
  const [paletteOpen, setPaletteOpen] = useCommandPaletteHotkey();

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

  const primaryNav: NavItem[] = [
    { to: '/lifecycles', label: 'Lifecycles' },
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/alerts', label: 'Alerts', badge: unread },
    { to: '/documents', label: 'Documents' },
    { to: '/partners-config', label: 'Partners' },
  ];

  const monitorNav: MobileNavItem[] = [
    { to: '/lifecycles', label: 'Lifecycles' },
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/alerts', label: 'Alerts', badge: unread },
  ];
  const exploreNav: MobileNavItem[] = [
    { to: '/documents', label: 'Documents' },
    { to: '/metrics', label: 'Metrics' },
  ];
  const configureNav: MobileNavItem[] = [
    { to: '/partners-config', label: 'Partners' },
    { to: '/channels', label: 'Channels' },
    { to: '/settings', label: 'Settings' },
    { to: '/help', label: 'Help' },
    { to: '/users', label: 'Users', adminOnly: true, testId: 'nav-users' },
    { to: '/admin/audit', label: 'Audit', adminOnly: true, testId: 'nav-audit' },
  ];

  const moreExplore: NavItem[] = [{ to: '/metrics', label: 'Metrics' }];
  const moreConfigure: NavItem[] = [
    { to: '/channels', label: 'Channels' },
    { to: '/settings', label: 'Settings' },
    { to: '/help', label: 'Help' },
  ];
  const moreAdmin: NavItem[] = [
    { to: '/users', label: 'Users', testId: 'nav-users' },
    { to: '/admin/audit', label: 'Audit', testId: 'nav-audit' },
  ];

  return (
    <div className="min-h-screen bg-[var(--color-surface-bg)] text-[var(--color-fg)]">
      <header
        ref={headerRef}
        className="sticky top-0 z-30 border-b border-[var(--color-surface-border)] bg-[var(--color-surface-card)]/95 backdrop-blur"
      >
        <div className="layout-shell flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 sm:gap-x-4">
          <NavLink
            to="/"
            className="flex min-w-0 shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight text-[var(--color-fg)] hover:text-[var(--color-brand-700)]"
          >
            <span
              aria-hidden
              className="grid h-6 w-6 place-items-center rounded-md bg-[var(--color-brand-500)] text-[11px] font-bold leading-none text-white shadow-xs"
            >
              EH
            </span>
            <span className="truncate sm:max-w-none">EDI Hub</span>
          </NavLink>

          <nav className="hidden min-w-0 items-center gap-1 lg:flex" aria-label="Primary">
            {primaryNav.map((item) => (
              <NavItemLink key={item.to} item={item} />
            ))}
            <DropdownMenu>
              <DropdownMenu.Trigger asChild>
                <button type="button" className={`group ${triggerClass}`} data-testid="nav-more">
                  More
                  <Caret />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content
                align="start"
                sideOffset={4}
                className="max-h-[min(24rem,70dvh)] min-w-[200px] overflow-y-auto"
              >
                <DropdownMenu.Label>Explore</DropdownMenu.Label>
                {moreExplore.map((item) => (
                  <DropdownMenu.Item key={item.to} onSelect={() => navigate(item.to)}>
                    {item.label}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator />
                <DropdownMenu.Label>Configure</DropdownMenu.Label>
                {moreConfigure.map((item) => (
                  <DropdownMenu.Item key={item.to} onSelect={() => navigate(item.to)}>
                    {item.label}
                  </DropdownMenu.Item>
                ))}
                {isAdmin ? (
                  <>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Label>Admin</DropdownMenu.Label>
                    {moreAdmin.map((item) => (
                      <DropdownMenu.Item
                        key={item.to}
                        data-testid={item.testId}
                        onSelect={() => navigate(item.to)}
                      >
                        {item.label}
                      </DropdownMenu.Item>
                    ))}
                  </>
                ) : null}
              </DropdownMenu.Content>
            </DropdownMenu>
          </nav>

          <div className="min-w-0 shrink">
            <SetupProgressIndicator />
          </div>

          <div
            className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3"
            data-testid="auth-controls"
          >
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              data-testid="open-command-palette"
              aria-label="Open command palette"
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-surface-border)] text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30 sm:inline-flex md:w-auto md:gap-2 md:px-2"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <span className="hidden text-xs md:inline">Jump to…</span>
              <kbd className="hidden rounded border border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] px-1 font-mono text-[10px] lg:inline">
                ⌘K
              </kbd>
            </button>
            <SearchBox />
            <AlertBell />
            <span aria-hidden className="hidden h-5 w-px shrink-0 bg-[var(--color-surface-border)] md:block" />
            <div className="min-w-0 max-w-[8rem] shrink md:max-w-[10rem] lg:max-w-none">
              <OrganizationSwitcher
                hidePersonal
                afterSelectOrganizationUrl="/"
                appearance={{
                  elements: {
                    organizationSwitcherTrigger:
                      'max-w-full truncate rounded-md px-2 py-1 text-sm hover:bg-[var(--color-surface-muted)]',
                    organizationPreviewText: 'truncate',
                  },
                }}
              />
            </div>
            <div className="shrink-0">
              <UserButton />
            </div>
            <MobileNavDrawer
              monitorNav={monitorNav}
              exploreNav={exploreNav}
              configureNav={configureNav}
            />
          </div>
        </div>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {showDropBanner ? (
        <div
          className="border-b border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-[var(--layout-gutter-x)] py-2 text-center text-sm text-[var(--color-brand-800)]"
          data-testid="drop-folder-banner"
        >
          Drop an EDI file into{' '}
          <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs break-all">
            {setupQ.data!.dropFolderPath}
          </code>{' '}
          to ingest it.
        </div>
      ) : null}

      <main id="main-content" className="layout-shell py-6">
        <Outlet />
      </main>
    </div>
  );
}
