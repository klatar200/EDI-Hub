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
  alertSeverityTone,
  alertStatusTone,
  type StatusTone,
  ErrorState,
  EmptyState,
  Skeleton,
  Card,
  FormField,
  Select,
  Input,
  FilterToolbar,
} from '../components/ui';
import { RequireRole, useHasRole } from '../lib/useRole.tsx';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
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
  { value: 'UNKNOWN_ISA', label: 'Unknown ISA sender' },
];

const TYPE_LABEL: Record<AlertType, string> = {
  MISSING_ACK: 'Missing 997 ack',
  REJECTION_RATE_SPIKE: 'Rejection-rate spike',
  STALE_TRAFFIC: 'Stale traffic',
  UNKNOWN_ISA: 'Unknown ISA sender',
};

function alertTypeLabel(alert: AlertRecord): string {
  if (alert.type === 'UNKNOWN_ISA') return TYPE_LABEL.UNKNOWN_ISA;
  if (alert.sourceRef.scope === 'unknown_isa') return 'Unknown ISA sender';
  return TYPE_LABEL[alert.type];
}

function slaOverdueScore(alert: AlertRecord): number {
  const ref = alert.sourceRef;
  const within = typeof ref.withinMinutes === 'number' ? ref.withinMinutes : null;
  const overdue = typeof ref.overdueMinutes === 'number' ? ref.overdueMinutes : null;
  if (within !== null && overdue !== null) return overdue - within;
  if (alert.type === 'REJECTION_RATE_SPIKE') {
    const current = typeof ref.currentRate === 'number' ? ref.currentRate : 0;
    const baseline = typeof ref.baselineRate === 'number' ? ref.baselineRate : 0;
    return current - baseline;
  }
  return 0;
}

function sortAlerts(items: AlertRecord[], sortBy: 'sla' | 'recent'): AlertRecord[] {
  if (sortBy === 'recent') return items;
  return [...items].sort((a, b) => {
    const diff = slaOverdueScore(b) - slaOverdueScore(a);
    if (diff !== 0) return diff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/** Partner name is the prefix before the first colon in the detector title. */
function partnerFromTitle(title: string): string | null {
  const idx = title.indexOf(':');
  if (idx <= 0) return null;
  const name = title.slice(0, idx).trim();
  return name.length > 0 ? name : null;
}

function formatAgeMinutes(createdAt: string): string {
  const ageM = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));
  if (ageM < 60) return `${ageM}m old`;
  const ageH = Math.floor(ageM / 60);
  if (ageH < 48) return `${ageH}h old`;
  return `${Math.floor(ageH / 24)}d old`;
}

/** Structured age vs SLA for triage — uses sourceRef when the detector populated it. */
function ageVsSlaMeta(alert: AlertRecord): { label: string; tone: StatusTone; testId: string } {
  const ref = alert.sourceRef;
  const within = typeof ref.withinMinutes === 'number' ? ref.withinMinutes : null;
  const overdue = typeof ref.overdueMinutes === 'number' ? ref.overdueMinutes : null;
  if (within !== null && overdue !== null) {
    const breached = overdue > within;
    return {
      label: `${overdue}m elapsed · SLA ${within}m`,
      tone: breached ? 'error' : 'warn',
      testId: 'alert-age-sla',
    };
  }
  if (alert.type === 'REJECTION_RATE_SPIKE') {
    const current = typeof ref.currentRate === 'number' ? ref.currentRate : null;
    const baseline = typeof ref.baselineRate === 'number' ? ref.baselineRate : null;
    if (current !== null && baseline !== null) {
      const currentPct = (current * 100).toFixed(1);
      const baselinePct = (baseline * 100).toFixed(1);
      return {
        label: `${currentPct}% now · baseline ${baselinePct}%`,
        tone: current > baseline ? 'error' : 'warn',
        testId: 'alert-age-sla',
      };
    }
  }
  return { label: formatAgeMinutes(alert.createdAt), tone: 'neutral', testId: 'alert-age' };
}

const SEVERITY_BAR: Record<AlertSeverity, string> = {
  info: 'bg-[var(--color-info-500)]',
  warning: 'bg-[var(--color-warn-500)]',
  critical: 'bg-[var(--color-error-500)]',
};

export function AlertsPage(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const isOps = useHasRole('ops');
  const [status, setStatus] = useState<AlertStatus | ''>('active');
  const [type, setType] = useState<AlertType | ''>('');
  const [partnerName, setPartnerName] = useState('');
  const [sortBy, setSortBy] = useState<'sla' | 'recent'>('sla');
  const alertsKey = useTenantQueryKey('alerts', status, type, partnerName);
  const alertsPrefix = useTenantQueryKey('alerts');
  const alertsQ = useQuery({
    queryKey: alertsKey,
    queryFn: () => api.alerts.list({
      status: status || undefined,
      type: type || undefined,
      partnerName: partnerName.trim() || undefined,
    }),
  });

  // Phase UI Sprint 4 — write-path feedback via toasts. Replaces the
  // silent success / generic-error pattern. Errors surface the server's
  // structured message when present so the operator can self-diagnose.
  const ackM = useMutation({
    mutationFn: (id: string) => api.alerts.ack(id, { who: 'ops' }),
    onSuccess: () => {
      toast.success('Alert acknowledged');
      void qc.invalidateQueries({ queryKey: alertsPrefix });
    },
    onError: (err) => {
      toast.error('Could not acknowledge', { description: err instanceof Error ? err.message : 'Server returned an error.' });
    },
  });
  const snoozeM = useMutation({
    mutationFn: ({ id, minutes }: { id: string; minutes: number }) => api.alerts.snooze(id, minutes),
    onSuccess: () => {
      toast.success('Alert snoozed');
      void qc.invalidateQueries({ queryKey: alertsPrefix });
    },
    onError: (err) => {
      toast.error('Could not snooze', { description: err instanceof Error ? err.message : 'Server returned an error.' });
    },
  });
  const detectM = useMutation({
    mutationFn: () => api.runDetection(),
    onSuccess: () => {
      toast.success('Detection pass complete');
      void qc.invalidateQueries({ queryKey: alertsPrefix });
    },
    onError: (err) => {
      toast.error('Detection failed', { description: err instanceof Error ? err.message : 'Server returned an error.' });
    },
  });
  const bulkAckM = useMutation({
    mutationFn: () => api.alerts.bulkAck({
      who: 'ops',
      partnerName: partnerName.trim() || undefined,
    }),
    onSuccess: (res) => {
      toast.success(`Acknowledged ${res.acknowledged} alert${res.acknowledged === 1 ? '' : 's'}`);
      void qc.invalidateQueries({ queryKey: alertsPrefix });
    },
    onError: (err) => {
      toast.error('Bulk acknowledge failed', { description: err instanceof Error ? err.message : 'Server returned an error.' });
    },
  });

  const items = sortAlerts(alertsQ.data?.items ?? [], sortBy);
  const activeCount = items.filter((a) => a.status === 'active').length;
  // S2 — "did the operator filter down to nothing?" The Status dropdown is a
  // navigational pivot (Active / Acknowledged / Snoozed tabs), not narrowing.
  // Type and Partner are the actual filters.
  const hasNarrowingFilter = type !== '' || partnerName.trim() !== '';
  const secondaryFilterCount = (partnerName.trim() ? 1 : 0) + (type !== '' ? 1 : 0);

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle="Missing acknowledgments + rejection-rate spikes against your configured partners."
        actions={
          <RequireRole role="ops">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn"
                data-testid="run-detection"
                disabled={detectM.isPending}
                onClick={() => detectM.mutate()}
              >
                {detectM.isPending ? 'Running…' : 'Run detection'}
              </button>
              {activeCount > 0 && status === 'active' ? (
                <button
                  type="button"
                  className="btn-primary"
                  data-testid="bulk-ack"
                  disabled={bulkAckM.isPending}
                  onClick={() => bulkAckM.mutate()}
                >
                  {bulkAckM.isPending ? 'Working…' : `Ack all (${activeCount})`}
                </button>
              ) : null}
            </div>
          </RequireRole>
        }
      />

      <Card className="container-panel mb-3">
        <div className="p-3">
          <FilterToolbar
            activeSecondaryCount={secondaryFilterCount}
            inline={
              <>
                <FormField label="Status">
                  <Select size="sm" value={status} onChange={(e) => setStatus(e.target.value as AlertStatus | '')}>
                    {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </FormField>
                <FormField label="Sort">
                  <Select size="sm" value={sortBy} onChange={(e) => setSortBy(e.target.value as 'sla' | 'recent')}>
                    <option value="sla">SLA breach first</option>
                    <option value="recent">Most recent</option>
                  </Select>
                </FormField>
              </>
            }
            secondary={
              <>
                <FormField label="Partner">
                  <Input
                    size="sm"
                    placeholder="Filter by name…"
                    value={partnerName}
                    onChange={(e) => setPartnerName(e.target.value)}
                    data-testid="partner-filter"
                  />
                </FormField>
                <FormField label="Type">
                  <Select size="sm" value={type} onChange={(e) => setType(e.target.value as AlertType | '')}>
                    {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </FormField>
              </>
            }
          />
        </div>
      </Card>

      {alertsQ.isLoading ? (
        <Skeleton.Table rows={4} columnWidths={['100%']} />
      ) : alertsQ.isError ? (
        <ErrorState
          title="Could not load alerts"
          description="The API isn't responding. Make sure the server is running and try again."
          action={<button className="btn" onClick={() => alertsQ.refetch()}>Retry</button>}
        />
      ) : items.length === 0 ? (
        // S2 — branched empty state.
        //   * Narrowed: the operator filtered down to nothing → offer a
        //     Clear-filters action and stop pushing "Run detection" at them.
        //   * Default (status=active, no type, no partnerName): this is the
        //     healthy state. Friendly copy; offer Run-detection for ops.
        //   * Non-default but not "active": e.g. "Acknowledged" tab — show
        //     a quiet "nothing here" so it doesn't read like a problem.
        hasNarrowingFilter ? (
          <EmptyState
            title="No alerts match these filters"
            description="Try widening Status, Type, or Partner — or clear the filters entirely."
            action={
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setStatus('active');
                  setType('');
                  setPartnerName('');
                }}
              >
                Clear filters
              </button>
            }
          />
        ) : status === 'active' ? (
          <EmptyState
            title="No active alerts"
            description="You're caught up. Run detection to scan for missing acks, rejection spikes, and stale traffic."
            action={isOps ? (
              <button
                type="button"
                className="btn"
                data-testid="empty-run-detection"
                disabled={detectM.isPending}
                onClick={() => detectM.mutate()}
              >
                {detectM.isPending ? 'Running…' : 'Run detection'}
              </button>
            ) : null}
          />
        ) : (
          <EmptyState
            title={status === 'acknowledged' ? 'No acknowledged alerts' : status === 'resolved' ? 'No resolved alerts' : 'No alerts'}
            description="Switch back to Active to see what's open."
          />
        )
      ) : (
        <ol className="space-y-2">
          {items.map((a) => (
            <AlertRow
              key={a.id}
              alert={a}
              typeLabel={alertTypeLabel(a)}
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
  typeLabel,
  onAck,
  onSnooze,
  pending,
}: {
  alert: AlertRecord;
  typeLabel: string;
  onAck: () => void;
  onSnooze: (minutes: number) => void;
  pending: boolean;
}): JSX.Element {
  const preview = Array.isArray(alert.sourceRef.previewTrail) ? alert.sourceRef.previewTrail : [];
  const poNumber = typeof alert.sourceRef.poNumber === 'string' ? alert.sourceRef.poNumber : null;
  const snoozedUntil = alert.suppressUntil ? new Date(alert.suppressUntil) : null;
  const isSnoozed = snoozedUntil !== null && snoozedUntil.getTime() > Date.now();
  const partner = partnerFromTitle(alert.title);
  const ageMeta = ageVsSlaMeta(alert);

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
              <StatusPill tone={alertSeverityTone(alert.severity)} withDot>{alert.severity}</StatusPill>
              <StatusPill tone={alertStatusTone(alert.status)} size="sm">{alert.status}</StatusPill>
              {partner ? (
                <span
                  data-testid="alert-partner"
                  className="inline-flex items-center rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-fg)]"
                >
                  {partner}
                </span>
              ) : null}
              <span
                data-testid="alert-type-label"
                className="inline-flex items-center rounded-full bg-[var(--color-brand-50)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-brand-700)]"
              >
                {typeLabel}
              </span>
              <span data-testid={ageMeta.testId}>
                <StatusPill tone={ageMeta.tone} size="sm">{ageMeta.label}</StatusPill>
              </span>
              <span className="ml-auto text-xs text-[var(--color-fg-muted)] tabular-nums">
                {new Date(alert.createdAt).toLocaleString()}
              </span>
            </div>
            <h2 className="text-sm font-semibold text-[var(--color-fg)]">{alert.title}</h2>
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
