/**
 * Phase 9 Sprint 3 — Role context for the web app.
 */
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { HubApiAccessError } from '../components/HubApiAccessError.tsx';
import { api, type UserRecord, type UserRole } from './api.ts';

interface MeContextValue {
  me: UserRecord | null;
  isLoading: boolean;
  isError: boolean;
  orgId?: string;
}

const MeContext = createContext<MeContextValue>({
  me: null,
  isLoading: true,
  isError: false,
  orgId: undefined,
});

export function MeProvider({
  children,
  orgId,
}: {
  children: ReactNode;
  orgId?: string;
}): JSX.Element {
  const q = useQuery({
    queryKey: ['me', orgId],
    queryFn: () => api.me(),
    retry: false,
    staleTime: 60_000,
    enabled: !!orgId,
  });

  if (q.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-bg)] p-6">
        <p className="text-sm text-[var(--color-fg-muted)]">Loading your hub profile…</p>
      </div>
    );
  }

  if (q.isError) {
    return <HubApiAccessError error={q.error} />;
  }

  return (
    <MeContext.Provider
      value={{ me: q.data ?? null, isLoading: false, isError: false, orgId }}
    >
      {children}
    </MeContext.Provider>
  );
}

export function useMe(): MeContextValue {
  return useContext(MeContext);
}

/** True once GET /api/me succeeded — gate data queries to avoid 403 storms. */
export function useApiReady(): boolean {
  const { me, isLoading, isError } = useMe();
  return !isLoading && !isError && me != null;
}

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, ops: 1, admin: 2 };

export function useHasRole(required: UserRole): boolean {
  const { me } = useMe();
  if (!me) return false;
  return ROLE_RANK[me.role] >= ROLE_RANK[required];
}

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
