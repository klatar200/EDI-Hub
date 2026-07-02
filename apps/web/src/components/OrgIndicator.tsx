/**
 * OrgIndicator — header-level org display that adapts to membership count.
 *
 * Why this exists:
 *   The vast majority of hub users belong to exactly one Clerk organization
 *   (their employer). Showing a full <OrganizationSwitcher /> for that case
 *   implies "you probably have multiple orgs to pick from" and adds noise
 *   to a header that already carries search, alerts, and account chrome.
 *
 *   A minority of users legitimately belong to 2+ orgs — EDI consultants,
 *   MSPs, and parent/subsidiary structures like Davidson Specialty Foods
 *   owning C & S Specialty Foods, where each subsidiary is its own tenant
 *   with its own ISA IDs and trading-partner setup. Those users need the
 *   switcher and would be blocked without it.
 *
 * Behavior:
 *   - Memberships still loading → fall back to the switcher (safer default).
 *   - Two or more memberships → render Clerk's <OrganizationSwitcher />.
 *   - Exactly one membership → render a dropdown that shows the org name
 *     as the trigger and org-scoped destinations as menu items (Trading
 *     partners, Channels, Usage & metrics, Organization settings, plus
 *     Users and Audit log for admins). Same interaction shape as the
 *     user avatar dropdown, so the two feel like a pair.
 *
 * The multi-tenant plumbing underneath (Prisma tenant extension, ALS-scoped
 * Fastify plugin, tenant-scoped React Query keys, OrgCacheReset) is unchanged
 * — this component only decides what to show in the header, not how tenant
 * isolation works.
 */
import { OrganizationSwitcher, useOrganization, useOrganizationList } from '@clerk/react';
import { useNavigate } from 'react-router-dom';
import { useHasRole } from '../lib/useRole.tsx';
import { DropdownMenu } from './ui';

const SWITCHER_APPEARANCE = {
  elements: {
    organizationSwitcherTrigger:
      'max-w-full truncate rounded-md px-2 py-1 text-sm hover:bg-[var(--color-surface-muted)]',
    organizationPreviewText: 'truncate',
  },
} as const;

interface OrgNavItem {
  to: string;
  label: string;
  testId?: string;
}

/** Org-scoped destinations available to any role. Mirrors the "Configure"
 *  section of the sidebar so users get a second entry point without a new
 *  concept to learn. Order matches Epicor's 1EDI Managed Exchange pattern
 *  (partners first, usage-style report near the top). */
const ORG_NAV: readonly OrgNavItem[] = [
  { to: '/partners-config', label: 'Trading partners' },
  { to: '/channels', label: 'Channels' },
  { to: '/metrics', label: 'Usage & metrics' },
  { to: '/settings', label: 'Organization settings' },
];

/** Admin-only org destinations. Hidden entirely for viewer/ops so the menu
 *  doesn't dangle unclickable items. */
const ORG_NAV_ADMIN: readonly OrgNavItem[] = [
  { to: '/users', label: 'Users', testId: 'org-menu-users' },
  { to: '/admin/audit', label: 'Audit log', testId: 'org-menu-audit' },
];

function BuildingIcon(): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M3.5 17.5V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v13.5" />
      <path d="M2 17.5h16" strokeLinecap="round" />
      <path
        d="M7 7h2M7 10h2M7 13h2M12 7h2M12 10h2M12 13h2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Caret(): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className="h-3 w-3 shrink-0 transition-transform group-data-[state=open]:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OrgIndicator(): JSX.Element {
  const { organization } = useOrganization();
  const { userMemberships, isLoaded } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const navigate = useNavigate();
  const isAdmin = useHasRole('admin');

  // While membership count is unknown, keep the switcher — never accidentally
  // hide a multi-org user's ability to switch.
  const membershipCount = userMemberships?.count;
  const showSwitcher = !isLoaded || membershipCount === undefined || membershipCount > 1;

  if (showSwitcher) {
    return (
      <div
        className="min-w-0 max-w-[min(10rem,100%)] shrink md:max-w-[10rem] lg:max-w-none"
        data-testid="org-switcher"
      >
        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/"
          appearance={SWITCHER_APPEARANCE}
        />
      </div>
    );
  }

  const orgName = organization?.name ?? '—';

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="org-menu-trigger"
          aria-label={`${orgName} — organization menu`}
          className="group inline-flex min-w-0 max-w-[min(12rem,100%)] cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30 data-[state=open]:bg-[var(--color-surface-muted)] md:max-w-[12rem] lg:max-w-[16rem]"
        >
          <BuildingIcon />
          <span className="truncate">{orgName}</span>
          <Caret />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" sideOffset={6} className="min-w-[220px]">
        <DropdownMenu.Label>{orgName}</DropdownMenu.Label>
        <DropdownMenu.Separator />
        {ORG_NAV.map((item) => (
          <DropdownMenu.Item
            key={item.to}
            data-testid={item.testId}
            onSelect={() => navigate(item.to)}
          >
            {item.label}
          </DropdownMenu.Item>
        ))}
        {isAdmin ? (
          <>
            <DropdownMenu.Separator />
            <DropdownMenu.Label>Admin</DropdownMenu.Label>
            {ORG_NAV_ADMIN.map((item) => (
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
  );
}
