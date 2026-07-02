/**
 * Layout shell — slim primary nav with overflow menu.
 *
 * UR1 — responsive header wrap, progressive chrome collapse, mobile nav drawer.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UserMenu } from './UserMenu.tsx';
import { RequireRole, useApiReady, useHasRole } from '../lib/useRole.tsx';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { useSyncHeaderHeight } from '../lib/useSyncHeaderHeight.ts';
import { SearchBox } from './SearchBox.tsx';
import { CommandPalette, useCommandPaletteHotkey } from './CommandPalette.tsx';
import { KeyboardShortcutsOverlay, useGlobalKeyboardHotkeys } from './KeyboardShortcutsOverlay.tsx';
import { modKeyLabel } from '../lib/keyboard.ts';
import { AlertBell } from './AlertBell.tsx';
import { SetupProgressIndicator } from './SetupProgressIndicator.tsx';
import { MobileNavDrawer } from './MobileNavDrawer.tsx';
import type { MobileNavItem } from './MobileNavDrawer.tsx';
import { DesktopSidebar } from './DesktopSidebar.tsx';
import { OrgIndicator } from './OrgIndicator.tsx';
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
  const location = useLocation();
  const isAdmin = useHasRole('admin');
  const [paletteOpen, setPaletteOpen] = useCommandPaletteHotkey();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  useGlobalKeyboardHotkeys({ onOpenShortcuts: openShortcuts });
  const modKey = modKeyLabel();

  // Client-side navigation to /some-path#anchor doesn't trigger the browser's
  // native hash-scroll. Nudge it manually after the route resolves so links
  // like /settings#notifications (from the user menu) land at the right card.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    // rAF gives React time to render the target before we look for it.
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [location.pathname, location.hash]);

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
    { to: '/documentation', label: 'Documentation', testId: 'nav-documentation' },
  ];

  const moreExplore: NavItem[] = [{ to: '/metrics', label: 'Metrics' }];
  const moreConfigure: NavItem[] = [
    { to: '/channels', label: 'Channels' },
    { to: '/settings', label: 'Settings' },
    { to: '/help', label: 'Help' },
    { to: '/documentation', label: 'Documentation', testId: 'nav-documentation' },
  ];
  const moreAdmin: NavItem[] = [
    { to: '/users', label: 'Users', testId: 'nav-users' },
    { to: '/admin/audit', label: 'Audit', testId: 'nav-audit' },
  ];

  return (
    <div className="min-h-screen overflow-x-clip bg-[var(--color-surface-bg)] text-[var(--color-fg)]">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <div className="2xl:flex 2xl:min-h-screen">
        <DesktopSidebar
          monitorNav={monitorNav}
          exploreNav={exploreNav}
          configureNav={configureNav}
        />
        <div className="flex min-w-0 flex-1 flex-col">
      <header
        ref={headerRef}
        className="sticky top-0 z-30 border-b border-[var(--color-surface-border)] bg-[var(--color-surface-card)]/95 backdrop-blur"
      >
        <div className="layout-shell flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 sm:gap-x-4 2xl:h-14 2xl:flex-nowrap 2xl:py-0">
          <NavLink
            to="/"
            className="flex min-w-0 shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight text-[var(--color-fg)] hover:text-[var(--color-brand-700)] 2xl:hidden"
          >
            <span
              aria-hidden
              className="grid h-6 w-6 place-items-center rounded-md bg-[var(--color-brand-500)] text-[11px] font-bold leading-none text-white shadow-xs"
            >
              EH
            </span>
            <span className="truncate sm:max-w-none">EDI Hub</span>
          </NavLink>

          <div className="min-w-0 flex-1 sm:max-w-[32rem]">
            <SearchBox />
          </div>

          <nav className="hidden min-w-0 items-center gap-1 lg:flex 2xl:hidden" aria-label="Primary">
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

          <div className="min-w-0 shrink 2xl:hidden">
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
              className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[var(--color-surface-border)] text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30 sm:inline-flex md:h-9 md:w-auto md:gap-2 md:px-2"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <span className="hidden text-xs md:inline">Jump to…</span>
              <kbd className="hidden rounded border border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] px-1 font-mono text-[10px] lg:inline">
                {modKey}K
              </kbd>
            </button>
            <AlertBell />
            <button
              type="button"
              onClick={openShortcuts}
              data-testid="open-keyboard-shortcuts"
              aria-label="Keyboard shortcuts"
              className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-md text-sm font-medium text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30 sm:inline-flex"
            >
              <span aria-hidden className="text-xl leading-none">?</span>
            </button>
            <span aria-hidden className="hidden h-5 w-px shrink-0 bg-[var(--color-surface-border)] md:block" />
            <OrgIndicator />
            <UserMenu />
            <MobileNavDrawer
              monitorNav={monitorNav}
              exploreNav={exploreNav}
              configureNav={configureNav}
            />
          </div>
        </div>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <KeyboardShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {showDropBanner ? (
        <div
          className="border-b border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-[var(--layout-gutter-x)] py-2 text-center text-sm leading-relaxed text-[var(--color-brand-800)] sm:py-2.5"
          data-testid="drop-folder-banner"
        >
          <p className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1">
            <span>Drop an EDI file into</span>
            <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs break-all">
              {setupQ.data!.dropFolderPath}
            </code>
            <span>to bring it in automatically.</span>
          </p>
        </div>
      ) : null}

      <main id="main-content" className="layout-shell py-6">
        <Outlet />
      </main>
        </div>
      </div>
    </div>
  );
}
