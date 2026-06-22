/**
 * UI Phase Sprint 2.5 — Alerts page, polished.
 *
 * Each alert renders as a Card with a severity-tinted left bar (Linear-
 * style). Severity + status both render as StatusPill, the type code
 * stays mono. Snooze + Acknowledge buttons keep their previous testIds
 * so the existing AlertsPage tests still pass.
 *
 * Filter selects move into a small Card-shaped strip; the empty state
 * tells the operator how to trigger the detector for testing.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { AlertRecord, AlertSeverity, AlertStatus, AlertType } from '@edi/shared';
import { api } from '../lib/api.ts';
import {
  PageHeader,
  StatusPill,
  type StatusTone,
  ErrorState,
  EmptyState,
  Skeleton,
  Card,
  FormField,
  Select,
} from '../components/ui';
import { useToast } from '../lib/useToast.tsx';

const SNOOZE_OPTIONS: Array<{ minutes: number; label: string }> = [
  { minutes: 60, label: '1 hour' },
  { minutes: 240, label: '4 hours' },
  { minutes: 1440, label: '24 hours' },
];

const STATUS_OPTIONS: Array<{ value: AlertStatus | ''; label: string }> = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
];
const TYPE_OPTIONS: Array<{ value: AlertType | ''; label: string }> = [
  { value: '', label: 'All types' },
  { value: 'MISSING_ACK', label: 'Missing 997 ack' },
  { value: 'REJECTION_RATE_SPIKE', label: 'Rejection-rate spike' },
  { value: 'STALE_TRAFFIC', label: 'Stale traffic' },
];

const SEVERITY_TONE: Record<AlertSeverity, StatusTone> = {
  info: 'info',
  warning: 'warn',
  critical: 'error',
};
const STATUS_TONE: Record<AlertStatus, StatusTone> = {
  active: 'error',
  acknowledged: 'success',
  resolved: 'neutral',
};
const SEVERITY_BAR: Record<AlertSeverity, string> = {
  info: 'bg-[var(--color-info-500)]',
  warning: 'bg-[var(--color-warn-500)]',
  critical: 'bg-[var(--color-error-500)]',
};

export function AlertsPage(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<AlertStatus | ''>('active');
  const [type, setType] = useState<AlertType | ''>('');
  const alertsQ = useQuery({
    queryKey: ['alerts', status, type],
    queryFn: () => api.alerts.list({ status: status || undefined, type: type || undefined }),
  });

  // Phase UI Sprint 4 — write-path feedback via toasts. Replaces the
  // silent success / generic-error pattern. Errors surface the server's
  // structured message when present so the operator can self-diagnose.
  const ackM = useMutation({
    mutationFn: (id: string) => api.alerts.ack(id, { who: 'ops' }),
    onSuccess: () => {
      toast.success('Alert acknowledged');
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (err) => {
      toast.error('Could not acknowledge', { description: err instanceof Error ? err.message : 'Server returned an error.' });
    },
  });
  const snoozeM = useMutation({
    mutationFn: ({ id, minutes }: { id: string; minutes: number }) => api.alerts.snooze(id, minutes),
    onSuccess: () => {
      toast.success('Alert snoozed');
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (err) => {
      toast.error('Could not snooze', { description: err instanceof Error ? err.message : 'Server returned an error.' });
    },
  });

  const items = alertsQ.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle="Missing acknowledgments + rejection-rate spikes against your configured partners."
        actions={
          <div className="flex gap-2">
            <FormField label="Status">
              <Select size="sm" value={status} onChange={(e) => setStatus(e.target.value as AlertStatus | '')}>
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </FormField>
            <FormField label="Type">
              <Select size="sm" value={type} onChange={(e) => setType(e.target.value as AlertType | '')}>
                {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </FormField>
          </div>
        }
      />

      {alertsQ.isLoading ? (
        <Skeleton.Table rows={4} columnWidths={['100%']} />
      ) : alertsQ.isError ? (
        <ErrorState
          title="Could not load alerts"
          description="The API isn't responding. Make sure the server is running and try again."
          action={<button className="btn" onClick={() => alertsQ.refetch()}>Retry</button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No alerts match these filters"
          description={
            <>
              Run <code className="rounded bg-[var(--color-surface-muted)] px-1 py-0.5 text-xs">npm run detect</code>{' '}
              to invoke the detector against your current data.
            </>
          }
        />
      ) : (
        <ol className="space-y-2">
          {items.map((a) => (
            <AlertRow
              key={a.id}
              alert={a}
              onAck={() => ackM.mutate(a.id)}
              onSnooze={(minutes) => snoozeM.mutate({ id: a.id, minutes })}
              pending={ackM.isPending || snoozeM.isPending}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function AlertRow({
  alert,
  onAck,
  onSnooze,
  pending,
}: {
  alert: AlertRecord;
  onAck: () => void;
  onSnooze: (minutes: number) => void;
  pending: boolean;
}): JSX.Element {
  const preview = Array.isArray(alert.sourceRef.previewTrail) ? alert.sourceRef.previewTrail : [];
  const poNumber = typeof alert.sourceRef.poNumber === 'string' ? alert.sourceRef.poNumber : null;
  const snoozedUntil = alert.suppressUntil ? new Date(alert.suppressUntil) : null;
  const isSnoozed = snoozedUntil !== null && snoozedUntil.getTime() > Date.now();

  return (
    <li data-testid="alert-row" className="relative">
      <Card className="overflow-hidden">
        {/* Severity-colored left bar — Linear-style. */}
        <div
          aria-hidden
          className={`absolute left-0 top-0 h-full w-1 ${SEVERITY_BAR[alert.severity]}`}
        />
        <div className="pl-4">
          <Card.Content className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={SEVERITY_TONE[alert.severity]} withDot>{alert.severity}</StatusPill>
              <StatusPill tone={STATUS_TONE[alert.status]} size="sm">{alert.status}</StatusPill>
              <span className="font-mono text-[11px] text-[var(--color-fg-subtle)]">{alert.type}</span>
              <h2 className="text-sm font-semibold text-[var(--color-fg)]">{alert.title}</h2>
              <span className="ml-auto text-xs text-[var(--color-fg-muted)] tabular-nums">
                {new Date(alert.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="text-sm text-[var(--color-fg-muted)]">{alert.body}</p>
            {preview.length > 0 ? (
              <div
                data-testid="preview-trail"
                className="rounded border border-[var(--color-warn-500)]/30 bg-[var(--color-warn-50)] px-2 py-1 text-xs text-[var(--color-warn-700)]"
              >
                <span className="font-medium">Preview mode:</span> would have delivered to{' '}
                {preview.map((p: { channel: string; recipient: string }) => `${p.channel}:${p.recipient}`).join(', ')}
              </div>
            ) : null}
            {isSnoozed ? (
              <div data-testid="snoozed-until" className="text-xs text-[var(--color-fg-muted)]">
                Snoozed until {snoozedUntil!.toLocaleString()}
              </div>
            ) : null}
            <div className="flex items-center justify-end gap-2 pt-1">
              {poNumber ? (
                <Link
                  to={`/lifecycle/${encodeURIComponent(poNumber)}`}
                  data-testid="lifecycle-link"
                  className="text-sm text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
                >
                  View lifecycle ({poNumber}) →
                </Link>
              ) : null}
              {alert.status === 'active' ? (
                <>
                  <select
                    className="select text-xs"
                    data-testid="snooze-select"
                    defaultValue=""
                    onChange={(e) => {
                      const m = Number(e.target.value);
                      if (m > 0) onSnooze(m);
                      e.target.value = '';
                    }}
                    disabled={pending}
                  >
                    <option value="">Snooze for…</option>
                    {SNOOZE_OPTIONS.map((o) => (
                      <option key={o.minutes} value={o.minutes}>{o.label}</option>
                    ))}
                  </select>
                  <button type="button" className="btn-primary" onClick={onAck} disabled={pending}>
                    {pending ? 'Working…' : 'Acknowledge'}
                  </button>
                </>
              ) : alert.acknowledgedBy ? (
                <span className="text-xs text-[var(--color-fg-muted)]">
                  Acknowledged by {alert.acknowledgedBy}
                  {alert.acknowledgedAt ? ` · ${new Date(alert.acknowledgedAt).toLocaleString()}` : ''}
                </span>
              ) : null}
            </div>
          </Card.Content>
        </div>
      </Card>
    </li>
  );
}
