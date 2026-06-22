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
import { useEffect } from 'react';
import { useAuth } from '@clerk/react';
import { setAuthTokenGetter } from '../lib/api.ts';

export function AuthBridge(): null {
  const { getToken } = useAuth();
  useEffect(() => {
    // Clerk's getToken caches a fresh JWT internally and re-mints when stale,
    // so we can call it on every fetch without rate-limiting concerns.
    setAuthTokenGetter(() => getToken());
    return () => {
      // On unmount (sign-out), reset to a noop so subsequent fetches don't
      // accidentally attach a stale token.
      setAuthTokenGetter(async () => null);
    };
  }, [getToken]);
  return null;
}
