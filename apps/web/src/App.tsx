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
 * Uses Clerk's `<Show>` component (current API) rather than the older
 * `<SignedIn>` / `<SignedOut>` pair. The OrganizationList + useOrganization
 * gate is load-bearing for multi-tenancy and is kept verbatim — every
 * Clerk Organization maps to one Tenant row.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import {
  OrganizationList,
  Show,
  SignIn,
  useOrganization,
} from '@clerk/react';
import { Layout } from './components/Layout.tsx';
import { AuthBridge } from './components/AuthBridge.tsx';
import { MeProvider } from './lib/useRole.tsx';
import { UsersPage } from './pages/UsersPage.tsx';
import { LifecyclesPage } from './pages/LifecyclesPage.tsx';
import { TransactionsPage } from './pages/TransactionsPage.tsx';
import { TransactionDetailPage } from './pages/TransactionDetailPage.tsx';
import { IngestionsPage } from './pages/IngestionsPage.tsx';
import { SearchPage } from './pages/SearchPage.tsx';
import { LifecyclePage } from './pages/LifecyclePage.tsx';
import { MetricsPage } from './pages/MetricsPage.tsx';
import { PartnersConfigPage } from './pages/PartnersConfigPage.tsx';
import { AlertsPage } from './pages/AlertsPage.tsx';
import { FirstRunWizardPage } from './pages/FirstRunWizardPage.tsx';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api.ts';
import { useHasRole } from './lib/useRole.tsx';

function CenteredCard({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-bg)] p-6">
      {children}
    </div>
  );
}

function SetupGate(): JSX.Element {
  const isAdmin = useHasRole('admin');
  const setupQ = useQuery({
    queryKey: ['setup'],
    queryFn: () => api.setup.get(),
    retry: false,
    staleTime: 10_000,
  });

  if (setupQ.isLoading) {
    return (
      <CenteredCard>
        <p className="text-sm text-[var(--color-fg-muted)]">Loading setup…</p>
      </CenteredCard>
    );
  }

  const status = setupQ.data;
  if (status?.desktopMode && !status.firstRunComplete) {
    if (isAdmin) return <FirstRunWizardPage />;
    return (
      <CenteredCard>
        <p className="max-w-md text-center text-sm text-[var(--color-fg-muted)]">
          An administrator needs to complete the first-run setup before you can use EDI Hub.
          Ask an admin to sign in and finish the setup wizard.
        </p>
      </CenteredCard>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<LifecyclesPage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/transactions/:id" element={<TransactionDetailPage />} />
        <Route path="/ingestions" element={<IngestionsPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/lifecycle/:po" element={<LifecyclePage />} />
        <Route path="/metrics" element={<MetricsPage />} />
        <Route path="/partners-config" element={<PartnersConfigPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
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
  return <SetupGate />;
}

export function App(): JSX.Element {
  return (
    <>
      <Show when="signed-out">
        <CenteredCard><SignIn routing="hash" /></CenteredCard>
      </Show>
      <Show when="signed-in">
        {/* AuthBridge installs the Clerk token getter into api.ts before any
            data fetch fires. Must live INSIDE the signed-in branch so Clerk
            has a session. */}
        <AuthBridge />
        <MeProvider>
          <OrgGate />
        </MeProvider>
      </Show>
    </>
  );
}
