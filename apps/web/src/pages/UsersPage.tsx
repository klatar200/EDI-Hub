/**
 * Phase 9 Sprint 3 — Users / team management.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type UserRole } from '../lib/api.ts';
import { RequireRole, useMe } from '../lib/useRole.tsx';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { UserMobileCards } from '../components/MobileTableCards.tsx';
import { usePreferMobileCards } from '../lib/useMediaQuery.ts';
import {
  PageHeader,
  DataTable,
  Select,
  ErrorState,
  EmptyState,
  Skeleton,
} from '../components/ui';
import { useToast } from '../lib/useToast.tsx';

const ROLE_OPTIONS: UserRole[] = ['viewer', 'ops', 'admin'];

export function UsersPage(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useMe();
  const preferMobileCards = usePreferMobileCards();
  const usersKey = useTenantQueryKey('users');
  const q = useQuery({ queryKey: usersKey, queryFn: () => api.users.list() });

  const update = useMutation({
    mutationFn: (input: { id: string; role: UserRole }) =>
      api.users.update(input.id, { role: input.role }),
    onSuccess: () => {
      toast.success('Role updated');
      void qc.invalidateQueries({ queryKey: usersKey });
    },
    onError: (err) => {
      toast.error('Could not update role', { description: err instanceof Error ? err.message : 'Server returned an error.' });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.users.remove(id),
    onSuccess: () => {
      toast.success('User access revoked');
      void qc.invalidateQueries({ queryKey: usersKey });
    },
    onError: (err) => {
      toast.error('Could not remove user', { description: err instanceof Error ? err.message : 'Server returned an error.' });
    },
  });

  const items = q.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="New users appear here when they're added to the Clerk organization. Role changes are admin-only; everyone else sees a read-only view."
      />

      {q.isLoading ? (
        <Skeleton.Table rows={5} columnWidths={['35%', '25%', '15%', '15%']} />
      ) : q.isError ? (
        <ErrorState
          title="Could not load users"
          description="The API isn't responding. Make sure the server is running and try again."
          action={<button className="btn" onClick={() => q.refetch()}>Retry</button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No users in this tenant yet"
          description="Invite someone via the Clerk dashboard — they'll appear here after their organizationMembership.created webhook fires."
        />
      ) : preferMobileCards ? (
        <UserMobileCards
          items={items}
          selfId={me?.id}
          rolePending={update.isPending}
          onRoleChange={(id, role) => update.mutate({ id, role })}
          onRemove={(id, email) => {
            if (confirm(`Revoke ${email}'s access to this tenant?`)) {
              remove.mutate(id);
            }
          }}
        />
      ) : (
        <DataTable>
          <DataTable.Thead>
            <DataTable.Tr>
              <DataTable.Th>Email</DataTable.Th>
              <DataTable.Th>Display name</DataTable.Th>
              <DataTable.Th>Role</DataTable.Th>
              <DataTable.Th className="text-right">Actions</DataTable.Th>
            </DataTable.Tr>
          </DataTable.Thead>
          <DataTable.Tbody>
            {items.map((u) => {
              const isSelf = me?.id === u.id;
              return (
                <DataTable.Tr key={u.id} className="group">
                  <DataTable.Td mono>{u.email}</DataTable.Td>
                  <DataTable.Td>
                    {u.displayName ?? <span className="text-[var(--color-fg-subtle)]">—</span>}
                  </DataTable.Td>
                  <DataTable.Td>
                    <RequireRole
                      role="admin"
                      fallback={<span className="text-[var(--color-fg-muted)]">{u.role}</span>}
                    >
                      <Select
                        size="sm"
                        data-testid={`role-select-${u.id}`}
                        value={u.role}
                        disabled={isSelf && update.isPending}
                        onChange={(e) => update.mutate({ id: u.id, role: e.target.value as UserRole })}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </Select>
                    </RequireRole>
                  </DataTable.Td>
                  <DataTable.Td className="text-right">
                    <RequireRole role="admin">
                      {isSelf ? (
                        <span className="text-xs text-[var(--color-fg-subtle)]">(you)</span>
                      ) : (
                        <span className="inline-flex justify-end opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            data-testid={`remove-user-${u.id}`}
                            className="rounded text-xs text-[var(--color-error-700)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--color-error-500)]/30"
                            onClick={() => {
                              if (confirm(`Revoke ${u.email}'s access to this tenant?`)) {
                                remove.mutate(u.id);
                              }
                            }}
                          >
                            Remove
                          </button>
                        </span>
                      )}
                    </RequireRole>
                  </DataTable.Td>
                </DataTable.Tr>
              );
            })}
          </DataTable.Tbody>
        </DataTable>
      )}
    </div>
  );
}
