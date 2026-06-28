/**
 * Phase 9 Sprint 3 — Role context for the web app.
 *
 * Fetches GET /me once on mount and exposes the current user's role + a
 * <RequireRole> wrapper for hiding actionable affordances.
 *
 * In dev-fallback mode (Clerk not configured), the API's /me returns a
 * synthetic admin user so the UI doesn't hide buttons from the local
 * developer. Once Clerk is wired, /me returns the real signed-in user.
 *
 * Pattern: pages still render for every role so a viewer can see the
 * structure of the app. Only mutating affordances disappear behind
 * RequireRole — this matches the build plan: "viewer" is read-only, not
 * locked out.
 */
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { api, type UserRecord, type UserRole } from './api.ts';

interface MeContextValue {
  me: UserRecord | null;
  isLoading: boolean;
  isError: boolean;
}

const MeContext = createContext<MeContextValue>({
  me: null,
  isLoading: true,
  isError: false,
});

export function MeProvider({
  children,
  orgId,
}: {
  children: ReactNode;
  /** Active Clerk organization id — scopes the /me cache per tenant. */
  orgId?: string;
}): JSX.Element {
  const q = useQuery({
    queryKey: ['me', orgId],
    queryFn: () => api.me(),
    retry: false,
    staleTime: 60_000,
    enabled: !!orgId,
  });
  return (
    <MeContext.Provider
      value={{ me: q.data ?? null, isLoading: q.isLoading, isError: q.isError }}
    >
      {children}
    </MeContext.Provider>
  );
}

export function useMe(): MeContextValue {
  return useContext(MeContext);
}

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, ops: 1, admin: 2 };

/** Returns true when the current user's role is at or above the required role. */
export function useHasRole(required: UserRole): boolean {
  const { me } = useMe();
  // Loading → assume false so destructive UI doesn't flash on mount.
  if (!me) return false;
  return ROLE_RANK[me.role] >= ROLE_RANK[required];
}

/** Render `children` only when the current user has at least `role`. */
export function RequireRole({
  role,
  children,
  fallback = null,
}: {
  role: UserRole;
  children: ReactNode;
  fallback?: ReactNode;
}): JSX.Element {
  const allowed = useHasRole(role);
  return <>{allowed ? children : fallback}</>;
}
