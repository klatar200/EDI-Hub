/**
 * SEC-C1 — Desktop LAN mode without Clerk (token gate).
 */
import { useLayoutEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setAuthTokenGetter } from './lib/api.ts';
import { ThemeProvider } from './lib/useTheme.tsx';
import { ToastProvider } from './lib/useToast.tsx';
import { AppRoutes } from './AppRoutes.tsx';
import { MeProvider } from './lib/useRole.tsx';
import { OrgCacheReset } from './components/OrgCacheReset.tsx';

const LAN_TOKEN_KEY = 'edi_hub_lan_token';
const DESKTOP_ORG_ID = 'desktop-lan';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

function LanTokenGate({ children }: { children: React.ReactNode }): JSX.Element {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(LAN_TOKEN_KEY));

  useLayoutEffect(() => {
    setAuthTokenGetter(async () => token);
    return () => setAuthTokenGetter(async () => null);
  }, [token]);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-bg)] p-6">
        <form
          className="w-full max-w-md space-y-4 rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface)] p-6 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const value = String(fd.get('token') ?? '').trim();
            if (!value) return;
            sessionStorage.setItem(LAN_TOKEN_KEY, value);
            setToken(value);
          }}
        >
          <h1 className="text-lg font-semibold text-[var(--color-fg)]">Desktop LAN sign-in</h1>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Enter the LAN API token configured on this hub server. Ask your administrator if you do not have it.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-[var(--color-fg-muted)]">API token</span>
            <input
              name="token"
              type="password"
              className="input w-full font-mono"
              autoComplete="off"
              data-testid="lan-token-input"
              required
            />
          </label>
          <button type="submit" className="btn-primary w-full" data-testid="lan-token-submit">
            Connect
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}

export function DesktopLanRoot(): JSX.Element {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            <LanTokenGate>
              <OrgCacheReset />
              <MeProvider orgId={DESKTOP_ORG_ID}>
                <AppRoutes />
              </MeProvider>
            </LanTokenGate>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
