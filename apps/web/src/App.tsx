/**
 * Phase 9 Sprint 2 (revised) — Auth gate + routes.
 */
import {
  OrganizationList,
  SignIn,
  useAuth,
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
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <CenteredCard>
        <p className="text-sm text-[var(--color-fg-muted)]">Loading session…</p>
      </CenteredCard>
    );
  }

  if (!isSignedIn) {
    return (
      <CenteredCard>
        <SignIn routing="hash" />
      </CenteredCard>
    );
  }

  return (
    <>
      <AuthBridge />
      <OrgCacheReset />
      <AuthReadyGate>
        <OrgGate />
      </AuthReadyGate>
    </>
  );
}
