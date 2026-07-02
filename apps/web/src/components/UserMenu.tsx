/**
 * UserMenu — custom account dropdown replacing Clerk's <UserButton />.
 *
 * Why custom:
 *   Clerk's <UserButton /> lives in a portal with its own visual language
 *   (spacing, typography, focus ring) that never quite matches the app.
 *   Rebuilding on top of Clerk's hooks + our own <DropdownMenu /> primitive
 *   gives us:
 *     - Identical look and interaction to <OrgIndicator /> and the "More"
 *       nav dropdown, so all header dropdowns feel like one system.
 *     - Direct react-router navigation for our own routes (Organization
 *       settings, Manage notifications) — no widget-config gymnastics.
 *     - Radix keyboard + screen-reader semantics via <DropdownMenu>.
 *
 * What we keep from Clerk (the parts you don't want to reimplement):
 *   - Session identity: `useUser()` reads the same session <UserButton />
 *     reads. Avatar, name, and primary email come straight from there.
 *   - Sensitive account flows: "Account settings" calls
 *     `useClerk().openUserProfile()`, which mounts Clerk's own <UserProfile />
 *     modal on top of our menu. Password changes, MFA setup, connected
 *     accounts, email verification — all handled by Clerk, none of that
 *     surface implemented here.
 *   - Sign out: `useClerk().signOut()`. The App's <OrgGate> re-routes to
 *     <SignIn /> automatically once the session clears.
 */
import { useUser, useClerk } from '@clerk/react';
import { useNavigate } from 'react-router-dom';
import { DropdownMenu, ThemeToggle } from './ui';

/** Two-letter initials from a full name, falling back to the first two
 *  characters of the email local-part, then '?'. Used when Clerk has no
 *  avatar image for the user. */
function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts.length === 1 && parts[0].length > 0) return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) {
    const local = email.split('@')[0] ?? '';
    if (local.length > 0) return local.slice(0, 2).toUpperCase();
  }
  return '?';
}

function Avatar({
  imageUrl,
  initials,
  size = 'md',
}: {
  imageUrl: string | undefined;
  initials: string;
  size?: 'sm' | 'md';
}): JSX.Element {
  const dims = size === 'sm' ? 'h-8 w-8 text-[11px]' : 'h-9 w-9 text-xs';
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className={`${dims} shrink-0 rounded-full object-cover`}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${dims} grid shrink-0 place-items-center rounded-full bg-[var(--color-brand-500)] font-semibold leading-none text-white shadow-xs`}
    >
      {initials}
    </span>
  );
}

export function UserMenu(): JSX.Element | null {
  const { user, isLoaded } = useUser();
  const { openUserProfile, signOut } = useClerk();
  const navigate = useNavigate();

  // While the session is loading (or after sign-out mid-render) render a
  // placeholder circle so the header layout doesn't jump.
  if (!isLoaded || !user) {
    return (
      <span
        aria-hidden
        className="inline-block h-9 w-9 shrink-0 rounded-full bg-[var(--color-surface-muted)]"
        data-testid="user-menu-loading"
      />
    );
  }

  const displayName = user.fullName ?? user.username ?? null;
  const email = user.primaryEmailAddress?.emailAddress ?? null;
  const initials = initialsFor(displayName, email);
  const imageUrl = user.imageUrl && user.hasImage ? user.imageUrl : undefined;

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="user-menu-trigger"
          aria-label={displayName ? `Account menu for ${displayName}` : 'Account menu'}
          className="group inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:ring-2 hover:ring-[var(--color-surface-ring)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/40 data-[state=open]:ring-2 data-[state=open]:ring-[var(--color-brand-500)]/40"
        >
          <Avatar imageUrl={imageUrl} initials={initials} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" sideOffset={8} className="min-w-[240px]">
        {/* Identity block — not a menu item, just static display. */}
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar imageUrl={imageUrl} initials={initials} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[var(--color-fg)]">
              {displayName ?? email ?? 'Signed in'}
            </p>
            {email && displayName ? (
              <p className="truncate text-xs text-[var(--color-fg-muted)]">{email}</p>
            ) : null}
          </div>
        </div>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          data-testid="user-menu-account"
          onSelect={() => openUserProfile()}
        >
          Account settings
        </DropdownMenu.Item>
        <DropdownMenu.Item
          data-testid="user-menu-org-settings"
          onSelect={() => navigate('/settings')}
        >
          Organization settings
        </DropdownMenu.Item>
        <DropdownMenu.Item
          data-testid="user-menu-notifications"
          onSelect={() => navigate('/settings#notifications')}
        >
          Manage notifications
        </DropdownMenu.Item>
        {/* Theme picker — not a DropdownMenu.Item because we don't want the
             menu to close when the user flips theme. Rendered as a plain flex
             row inside the menu content so Radix leaves it alone. The
             ThemeToggle segments are still keyboard-reachable via Tab. */}
        <div
          className="flex items-center justify-between gap-3 px-2 py-2"
          data-testid="user-menu-theme"
        >
          <span className="text-sm text-[var(--color-fg-muted)]">Theme</span>
          <ThemeToggle />
        </div>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          data-testid="user-menu-sign-out"
          onSelect={() => {
            void signOut();
          }}
          className="text-[var(--color-error-700)] data-[highlighted]:bg-[var(--color-error-50)] data-[highlighted]:text-[var(--color-error-700)]"
        >
          Sign out
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
