/**
 * Layout shell — slim primary nav with overflow menu.
 *
 * U1/N1: the primary bar is cut to ~5 destinations so the day-to-day watch
 * surface is unambiguous; everything else lives under a single labeled
 * "More" menu (Radix `DropdownMenu`), grouped by intent (Explore / Configure
 * / Admin) so the menu still tells a new user how to find things.
 *
 *   Primary (always visible on lg+):
 *     Lifecycles · Dashboard · Alerts · Transactions · Partners
 *
 *   More ▾:
 *     Explore   — Ingestions, Metrics
 *     Configure — Channels, Settings, Help
 *     Admin     — Users, Audit  (admin only)
 *
 * Below lg the whole nav collapses behind a single menu button using the
 * existing native `<details>` disclosure (kept for zero extra deps on the
 * mobile path). Header is `sticky top-0 z-30` so it persists while data
 * tables scroll.
 */
import type { MouseEvent } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { OrganizationSwitcher, UserButton } from '@clerk/react';
import { RequireRole, useApiReady, useHasRole } from '../lib/useRole.tsx';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { SearchBox } from './SearchBox.tsx';
import { CommandPalette, useCommandPaletteHotkey } from './CommandPalette.tsx';
import { AlertBell } from './AlertBell.tsx';
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

const triggerClass =
  'inline-flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30 data-[state=open]:bg-[var(--color-surface-muted)] data-[state=open]:text-[var(--color-fg)]';

function Caret(): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className="h-3 w-3 transition-transform group-open:rotate-180 group-data-[state=open]:rotate-180"
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
  const navigate = useNavigate();
  const isAdmin = useHasRole('admin');
  // U4/N4 — global Cmd-K palette. Mounted once at the Layout level so the
  // hotkey works on every authenticated page.
  const [paletteOpen, setPaletteOpen] = useCommandPaletteHotkey();
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

  // Primary nav — 5 destinations covering the day-to-day watch + the two
  // most-used drill-ins. Everything else moves into the More menu below.
  // U3/N3 — "Documents" replaces the old "Transactions" slot; it now
  // covers both parsed transactions and raw ingestions behind one toggle.
  const primaryNav: NavItem[] = [
    { to: '/lifecycles', label: 'Lifecycles' },
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/alerts', label: 'Alerts', badge: unread },
    { to: '/documents', label: 'Documents' },
    { to: '/partners-config', label: 'Partners' },
  ];
  // Mobile keeps the old "Monitor / Explore / Configure" grouping for the
  // small-screen disclosure — the dropdown menu collapses to that there.
  const monitorNav: NavItem[] = [
    { to: '/lifecycles', label: 'Lifecycles' },
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/alerts', label: 'Alerts', badge: unread },
  ];
  const exploreNav: NavItem[] = [
    { to: '/documents', label: 'Documents' },
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

  // Overflow menu contents (desktop) — same items, regrouped to match what
  // is NOT already in the primary bar. Ingestions used to live here on its
  // own; it now folds into the primary "Documents" destination.
  const moreExplore: NavItem[] = [
    { to: '/metrics', label: 'Metrics' },
  ];
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

          {/* Desktop nav — 5 primary destinations + More overflow, hidden on small screens */}
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
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
              <DropdownMenu.Content align="start" sideOffset={4} className="min-w-[200px]">
                <DropdownMenu.Label>Explore</DropdownMenu.Label>
                {moreExplore.map((item) => (
                  <DropdownMenu.Item
                    key={item.to}
                    onSelect={() => navigate(item.to)}
                  >
                    {item.label}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator />
                <DropdownMenu.Label>Configure</DropdownMenu.Label>
                {moreConfigure.map((item) => (
                  <DropdownMenu.Item
                    key={item.to}
                    onSelect={() => navigate(item.to)}
                  >
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

          {/* Search + identity on the right */}
          <div className="ml-auto flex items-center gap-3" data-testid="auth-controls">
            {/* U4/N4 — Cmd-K hint button. Same opener as the keyboard
                hotkey, surfaced for users who don't know the shortcut. */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              data-testid="open-command-palette"
              aria-label="Open command palette"
              className="hidden items-center gap-2 rounded-md border border-[var(--color-surface-border)] px-2 py-1 text-xs text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30 sm:inline-flex"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <span className="hidden md:inline">Jump to…</span>
              <kbd className="rounded border border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] px-1 font-mono text-[10px]">⌘K</kbd>
            </button>
            <SearchBox />
            <AlertBell />
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

      {/* U4/N4 — Global Cmd-K palette. Lives outside the header so its
          <dialog> overlay isn't clipped by any header stacking context. */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

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
