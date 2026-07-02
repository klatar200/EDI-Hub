/**
 * Shared route tree — used by Clerk auth (App.tsx) and desktop LAN token mode.
 */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layout } from './components/Layout.tsx';
import { RequireRole, useApiReady, useHasRole } from './lib/useRole.tsx';
import { LifecyclesPage } from './pages/LifecyclesPage.tsx';
import { TransactionDetailPage } from './pages/TransactionDetailPage.tsx';
import { DocumentsPage } from './pages/DocumentsPage.tsx';
import { SearchPage } from './pages/SearchPage.tsx';
import { LifecyclePage } from './pages/LifecyclePage.tsx';
import { MetricsPage } from './pages/MetricsPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { PartnersConfigPage } from './pages/PartnersConfigPage.tsx';
import { AlertsPage } from './pages/AlertsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { ChannelsPage } from './pages/ChannelsPage.tsx';
import { AuditPage } from './pages/AuditPage.tsx';
import { TransactionSetsHelpPage } from './pages/TransactionSetsHelpPage.tsx';
import { HelpPage } from './pages/HelpPage.tsx';
import { DocumentationPage } from './pages/DocumentationPage.tsx';
import { FirstRunWizardPage } from './pages/FirstRunWizardPage.tsx';
import { UsersPage } from './pages/UsersPage.tsx';
import { api } from './lib/api.ts';
import { useTenantQueryKey } from './lib/useTenantQuery.ts';

function CenteredCard({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-bg)] p-6">
      {children}
    </div>
  );
}

/** U3/N3 — Documents merge. Old /transactions and /ingestions routes redirect
 *  into /documents with the appropriate view, preserving any in-flight filter
 *  query params so bookmarks and inbound links keep working. */
function RedirectToDocuments({ view }: { view: 'parsed' | 'raw' }): JSX.Element {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('view', view);
  return <Navigate to={`/documents?${params.toString()}`} replace />;
}

/** UI-1 — resolve the root path to the user's chosen landing page. Defaults to
 *  the Monitoring dashboard; users set this in Settings. */
function DefaultLanding(): JSX.Element {
  const apiReady = useApiReady();
  const prefsKey = useTenantQueryKey('preferences');
  const prefsQ = useQuery({
    queryKey: prefsKey,
    queryFn: () => api.preferences.get(),
    enabled: apiReady,
    retry: false,
    staleTime: 30_000,
  });
  if (apiReady && prefsQ.isPending) {
    return (
      <CenteredCard>
        <p className="text-sm text-[var(--color-fg-muted)]">Loading…</p>
      </CenteredCard>
    );
  }
  const landing = prefsQ.data?.preferences.defaultLanding ?? 'dashboard';
  return <Navigate to={landing === 'lifecycles' ? '/lifecycles' : '/dashboard'} replace />;
}

export function AppRoutes(): JSX.Element {
  const isAdmin = useHasRole('admin');
  const apiReady = useApiReady();
  const setupKey = useTenantQueryKey('setup');
  const setupQ = useQuery({
    queryKey: setupKey,
    queryFn: () => api.setup.get(),
    retry: false,
    staleTime: 10_000,
    enabled: apiReady,
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
        <Route path="/" element={<DefaultLanding />} />
        <Route path="/lifecycles" element={<LifecyclesPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        {/* U3/N3 — old list routes redirect into /documents. Detail routes
            stay where they are so deep links don't break. */}
        <Route path="/transactions" element={<RedirectToDocuments view="parsed" />} />
        <Route path="/transactions/:id" element={<TransactionDetailPage />} />
        <Route path="/ingestions" element={<RedirectToDocuments view="raw" />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/lifecycle/:po" element={<LifecyclePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/metrics" element={<MetricsPage />} />
        <Route path="/partners-config" element={<RequireRole role="admin"><PartnersConfigPage /></RequireRole>} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/help/transaction-sets" element={<TransactionSetsHelpPage />} />
        <Route path="/documentation" element={<Navigate to="/documentation/getting-started" replace />} />
        <Route path="/documentation/:sectionId" element={<DocumentationPage />} />
        <Route path="/admin/audit" element={<RequireRole role="admin"><AuditPage /></RequireRole>} />
        <Route path="/users" element={<RequireRole role="admin"><UsersPage /></RequireRole>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
