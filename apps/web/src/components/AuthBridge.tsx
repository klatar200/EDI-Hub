/**
 * Phase 9 Sprint 2 — Auth bridge.
 *
 * Plain modules can't call React hooks, so api.ts can't read the Clerk token
 * directly. This component lives inside <ClerkProvider> and calls Clerk's
 * useAuth() to install a token-getter into api.ts at mount time. After that,
 * every api.ts fetch attaches the current JWT automatically.
 *
 * Renders nothing. Mount it once near the root of the authenticated tree
 * (App.tsx does this inside the SignedIn block).
 */
import { useLayoutEffect, type ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import { setAuthTokenGetter, setUnauthorizedHandler } from '../lib/api.ts';

export function AuthBridge(): null {
  const { getToken, signOut } = useAuth();
  useLayoutEffect(() => {
    setAuthTokenGetter(() => getToken());
    setUnauthorizedHandler(() => {
      void signOut();
    });
    return () => {
      setAuthTokenGetter(async () => null);
      setUnauthorizedHandler(null);
    };
  }, [getToken, signOut]);
  return null;
}

/** Gate children until Clerk has loaded the session — avoids racing /me. */
export function AuthReadyGate({ children }: { children: ReactNode }): JSX.Element {
  const { isLoaded } = useAuth();
  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-bg)] p-6">
        <p className="text-sm text-[var(--color-fg-muted)]">Loading session…</p>
      </div>
    );
  }
  return <>{children}</>;
}
