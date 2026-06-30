/**
 * U5/O2 — persistent header setup progress until hub is fully configured.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { hubSetupStatus } from '@edi/shared';
import { api } from '../lib/api.ts';
import { useApiReady } from '../lib/useRole.tsx';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { Popover } from './ui';

export function SetupProgressIndicator(): JSX.Element | null {
  const apiReady = useApiReady();
  const setupKey = useTenantQueryKey('setup');
  const partnersKey = useTenantQueryKey('partners-config');
  const channelsKey = useTenantQueryKey('channels');

  const setupQ = useQuery({
    queryKey: setupKey,
    queryFn: () => api.setup.get(),
    refetchInterval: 30_000,
    retry: false,
    enabled: apiReady,
  });
  const partnersQ = useQuery({
    queryKey: partnersKey,
    queryFn: () => api.partnersConfig.list(),
    refetchInterval: 30_000,
    retry: false,
    enabled: apiReady,
  });
  const channelsQ = useQuery({
    queryKey: channelsKey,
    queryFn: () => api.channels.list(),
    refetchInterval: 30_000,
    retry: false,
    enabled: apiReady,
  });

  if (!apiReady || setupQ.isLoading || partnersQ.isLoading || channelsQ.isLoading) {
    return null;
  }

  const partners = partnersQ.data?.items ?? [];
  const partnersWithIsa = partners.filter((p) => p.isaSenderIds.length > 0).length;
  const status = hubSetupStatus({
    partnersWithIsa,
    ourIsaIds: setupQ.data?.ourIsaIds ?? [],
    channelCount: channelsQ.data?.channels.length ?? 0,
    hasIngested: setupQ.data?.hasIngested ?? false,
  });

  if (status.complete) return null;

  const nextGap = status.checks.find((c) => !c.ok);

  return (
    <Popover>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-testid="setup-progress-trigger"
          aria-label={`Setup progress: ${status.doneCount} of ${status.total} complete`}
          className="hidden items-center gap-1.5 rounded-md border border-[var(--color-warn-500)]/40 bg-[var(--color-warn-50)] px-2 py-1 text-xs font-medium text-[var(--color-warn-800)] transition hover:bg-[var(--color-warn-50)]/80 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30 sm:inline-flex"
        >
          Setup: {status.doneCount}/{status.total}
        </button>
      </Popover.Trigger>
      <Popover.Content align="start" className="w-64 p-0">
        <div className="border-b border-[var(--color-surface-border)] px-3 py-2">
          <h2 className="text-sm font-semibold text-[var(--color-fg)]">Hub setup</h2>
          <p className="text-xs text-[var(--color-fg-muted)]">
            {status.doneCount} of {status.total} complete
            {nextGap ? ` — next: ${nextGap.label}` : ''}
          </p>
        </div>
        <ul className="py-1" data-testid="setup-progress-list">
          {status.checks.map((check) => (
            <li key={check.id}>
              <Link
                to={check.to}
                data-testid={`setup-check-${check.id}`}
                className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-surface-muted)] ${
                  check.ok ? 'text-[var(--color-fg-subtle)]' : 'text-[var(--color-fg)]'
                }`}
              >
                <span
                  aria-hidden
                  className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${
                    check.ok
                      ? 'bg-[var(--color-success-500)] text-white'
                      : 'border border-[var(--color-surface-border)] text-[var(--color-fg-muted)]'
                  }`}
                >
                  {check.ok ? '✓' : '·'}
                </span>
                {check.label}
              </Link>
            </li>
          ))}
        </ul>
      </Popover.Content>
    </Popover>
  );
}
