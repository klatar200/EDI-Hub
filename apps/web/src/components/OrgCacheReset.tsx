/**
 * SEC-H2 — Clear React Query cache when the active Clerk organization changes.
 *
 * Without this, switching orgs navigates to `/` but stale tenant data can
 * remain visible until queries refetch or expire.
 */
import { useEffect, useRef } from 'react';
import { useOrganization } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';

export function OrgCacheReset(): null {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();
  const prevOrgId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const orgId = organization?.id;
    if (prevOrgId.current !== undefined && orgId !== prevOrgId.current) {
      queryClient.clear();
    }
    prevOrgId.current = orgId;
  }, [organization?.id, queryClient]);

  return null;
}
