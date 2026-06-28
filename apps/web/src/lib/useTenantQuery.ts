/**
 * SEC-H2 — Tenant-scoped React Query keys.
 *
 * Prefixes every cache key with the active Clerk organization id so org
 * switches cannot briefly surface another tenant's cached data (defense in
 * depth alongside OrgCacheReset's queryClient.clear()).
 */
import { useMe } from './useRole.tsx';

export function tenantQueryKey(orgId: string | undefined, ...parts: readonly unknown[]): readonly unknown[] {
  return [orgId ?? '_pending', ...parts] as const;
}

export function useTenantQueryKey(...parts: readonly unknown[]): readonly unknown[] {
  const { orgId } = useMe();
  return tenantQueryKey(orgId, ...parts);
}
