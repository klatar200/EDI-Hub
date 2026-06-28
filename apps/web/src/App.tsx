/**
 * Phase 9 Sprint 2 (revised) — Auth gate + routes.
 *
 * Three states, gated by Clerk:
 *   - Signed out          → centered <SignIn /> card.
 *   - Signed in, no org   → centered <OrganizationList /> so the user picks
 *                           or creates an org. Without an active org the API
 *                           would 403 on every data request.
 *   - Signed in + active  → normal app shell.
 *
 * Desktop LAN mode (no Clerk key) → see DesktopLanRoot.tsx.
 */
import {
  OrganizationList,
  Show,
  SignIn,
  useOrganization,
} from '@clerk/react';
import { AuthBridge, AuthReadyGate } from './components/AuthBridge.tsx';
import { OrgCacheReset } from './components/OrgCacheReset.tsx';
import { MeProvider } from './lib/useRole.tsx';
import { AppRoutes } from './AppRoutes.tsx';

function CenteredCard({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-bg)] p-6">
      {children}
    </div>
  );
}

function OrgGate(): JSX.Element {
  const { organization, isLoaded } = useOrganization();
  if (!isLoaded)
    return (
      <CenteredCard>
        <p className="text-sm text-[var(--color-fg-muted)]">Loading…</p>
      </CenteredCard>
    );
  if (!organization) {
    return (
      <CenteredCard>
        <div className="space-y-4">
          <p className="text-center text-sm text-[var(--color-fg-muted)]">
            Select an organization to continue, or create one to get started.
          </p>
          <OrganizationList hidePersonal afterSelectOrganizationUrl="/" afterCreateOrganizationUrl="/" />
        </div>
      </CenteredCard>
    );
  }
  return (
    <MeProvider orgId={organization.id}>
      <AppRoutes />
    </MeProvider>
  );
}

export function App(): JSX.Element {
  return (
    <>
      <Show when="signed-out">
        <CenteredCard><SignIn routing="hash" /></CenteredCard>
      </Show>
      <Show when="signed-in">
        <AuthBridge />
        <OrgCacheReset />
        <AuthReadyGate>
          <OrgGate />
        </AuthReadyGate>
      </Show>
    </>
  );
}
