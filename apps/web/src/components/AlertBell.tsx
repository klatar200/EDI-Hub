/**
 * U4/ST3 — header alert bell with unread count + quick peek.
 *
 * Complements the Alerts page: operators can glance at the top 5 active
 * alerts and ack without leaving their current screen.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { AlertRecord } from '@edi/shared';
import { api } from '../lib/api.ts';
import { useApiReady, useHasRole } from '../lib/useRole.tsx';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { useToast } from '../lib/useToast.tsx';
import { Popover, StatusPill, alertSeverityTone } from './ui';

const PEEK_LIMIT = 5;

const SEVERITY_BAR: Record<AlertRecord['severity'], string> = {
  info: 'bg-[var(--color-info-500)]',
  warning: 'bg-[var(--color-warn-500)]',
  critical: 'bg-[var(--color-error-500)]',
};

export function AlertBell(): JSX.Element {
  const apiReady = useApiReady();
  const isOps = useHasRole('ops');
  const qc = useQueryClient();
  const toast = useToast();
  const alertsBadgeKey = useTenantQueryKey('alerts', 'active', 'unread-badge');
  const alertsPrefix = useTenantQueryKey('alerts');

  const activeAlerts = useQuery({
    queryKey: alertsBadgeKey,
    queryFn: () => api.alerts.list({ status: 'active' }),
    refetchInterval: 30_000,
    retry: false,
    enabled: apiReady,
  });

  const items = activeAlerts.data?.items ?? [];
  const unread = items.length;
  const peekItems = items.slice(0, PEEK_LIMIT);

  const ackM = useMutation({
    mutationFn: (id: string) => api.alerts.ack(id, { who: 'ops' }),
    onSuccess: () => {
      toast.success('Alert acknowledged');
      void qc.invalidateQueries({ queryKey: alertsPrefix });
    },
    onError: (err) => {
      toast.error('Could not acknowledge', {
        description: err instanceof Error ? err.message : 'Server returned an error.',
      });
    },
  });

  return (
    <Popover>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-testid="alert-bell-trigger"
          aria-label={unread > 0 ? `${unread} unread alerts` : 'Alerts'}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unread > 0 ? (
            <span
              data-testid="alert-bell-badge"
              className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--color-error-500)] px-1 text-[10px] font-bold leading-none text-white"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </button>
      </Popover.Trigger>
      <Popover.Content align="end" className="w-[min(380px,90vw)] p-0">
        <div className="border-b border-[var(--color-surface-border)] px-3 py-2">
          <h2 className="text-sm font-semibold text-[var(--color-fg)]">Active alerts</h2>
          <p className="text-xs text-[var(--color-fg-muted)]">
            {unread === 0 ? 'Nothing needs attention right now.' : `${unread} open`}
          </p>
        </div>
        <div data-testid="alert-bell-peek" className="max-h-80 overflow-y-auto">
          {activeAlerts.isLoading ? (
            <p className="px-3 py-4 text-sm text-[var(--color-fg-muted)]">Loading…</p>
          ) : peekItems.length === 0 ? (
            <p className="px-3 py-4 text-sm text-[var(--color-fg-muted)]">You&apos;re caught up.</p>
          ) : (
            <ul>
              {peekItems.map((alert) => (
                <AlertPeekRow
                  key={alert.id}
                  alert={alert}
                  canAck={isOps}
                  pending={ackM.isPending}
                  onAck={() => ackM.mutate(alert.id)}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-[var(--color-surface-border)] px-3 py-2 text-right">
          <Link
            to="/alerts"
            data-testid="alert-bell-view-all"
            className="text-sm font-medium text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
          >
            View all alerts →
          </Link>
        </div>
      </Popover.Content>
    </Popover>
  );
}

function AlertPeekRow({
  alert,
  canAck,
  pending,
  onAck,
}: {
  alert: AlertRecord;
  canAck: boolean;
  pending: boolean;
  onAck: () => void;
}): JSX.Element {
  const poNumber = typeof alert.sourceRef.poNumber === 'string' ? alert.sourceRef.poNumber : null;

  return (
    <li
      data-testid={`alert-bell-item-${alert.id}`}
      className="relative border-b border-[var(--color-surface-border)] last:border-b-0"
    >
      <div aria-hidden className={`absolute left-0 top-0 h-full w-1 ${SEVERITY_BAR[alert.severity]}`} />
      <div className="px-3 py-2.5 pl-4">
        <div className="mb-1 flex items-center gap-2">
          <StatusPill tone={alertSeverityTone(alert.severity)} size="sm" withDot>
            {alert.severity}
          </StatusPill>
          <span className="text-[10px] text-[var(--color-fg-subtle)] tabular-nums">
            {new Date(alert.createdAt).toLocaleString()}
          </span>
        </div>
        <p className="text-sm font-medium text-[var(--color-fg)] line-clamp-2">{alert.title}</p>
        <p className="mt-0.5 text-xs text-[var(--color-fg-muted)] line-clamp-2">{alert.body}</p>
        <div className="mt-2 flex items-center justify-end gap-2">
          {poNumber ? (
            <Link
              to={`/lifecycle/${encodeURIComponent(poNumber)}`}
              className="text-xs text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
            >
              {poNumber} →
            </Link>
          ) : null}
          {canAck ? (
            <button
              type="button"
              data-testid={`alert-bell-ack-${alert.id}`}
              className="rounded border border-[var(--color-surface-border)] px-2 py-0.5 text-xs font-medium hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
              disabled={pending}
              onClick={onAck}
            >
              Ack
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
