/**
 * PS-6 — Settings hub: theme, SLA countdown, stale-traffic window, digest.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ALERT_TYPES } from '@edi/shared';
import type { AlertType, TenantSettingsPatch } from '@edi/shared';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { useTheme } from '../lib/useTheme.tsx';
import { ThemeToggle } from '../components/ui/ThemeToggle.tsx';
import { PageHeader, Card, FormField, Input, Select, ErrorState, Skeleton } from '../components/ui';
import { useToast } from '../lib/useToast.tsx';

const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  MISSING_ACK: 'Missing 997 acknowledgment',
  REJECTION_RATE_SPIKE: 'Rejection-rate spike',
  STALE_TRAFFIC: 'Stale traffic',
  UNKNOWN_ISA: 'Unknown ISA sender',
};

export function SettingsPage(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { mode } = useTheme();
  const settingsKey = useTenantQueryKey('settings');
  const q = useQuery({ queryKey: settingsKey, queryFn: () => api.settings.get() });

  const patch = useMutation({
    mutationFn: (input: TenantSettingsPatch) => api.settings.patch(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsKey });
      toast.success('Settings saved');
    },
    onError: () => toast.error('Could not save settings'),
  });

  if (q.isLoading) return <Skeleton.Table rows={4} columnWidths={['100%']} />;
  if (q.isError || !q.data) {
    return (
      <ErrorState
        title="Could not load settings"
        action={<button type="button" className="btn" onClick={() => void q.refetch()}>Retry</button>}
      />
    );
  }

  const s = q.data.settings;
  const canEdit = q.data.canEdit;

  function update(patchInput: TenantSettingsPatch): void {
    if (!canEdit) return;
    patch.mutate(patchInput);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Tenant preferences for monitoring, alerts, and display." />

      <Card className="p-4 space-y-4">
        <h2 className="text-sm font-semibold">Appearance</h2>
        <p className="text-sm text-[var(--color-fg-muted)]">
          Color theme (current: {mode}). Stored in this browser.
        </p>
        <ThemeToggle />
      </Card>

      <EdiIdentityCard canEdit={canEdit} />

      <Card className="p-4 space-y-4">
        <h2 className="text-sm font-semibold">Monitoring</h2>
        <FormField label="Global stale-traffic window (hours)">
          <Input
            type="number"
            min={1}
            max={168}
            disabled={!canEdit}
            value={s.staleTrafficWindowHours}
            onChange={(e) => update({ staleTrafficWindowHours: Number(e.target.value) })}
          />
        </FormField>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={s.slaCountdownEnabled}
            onChange={(e) => update({ slaCountdownEnabled: e.target.checked })}
          />
          Show SLA countdown on lifecycle rows
        </label>
      </Card>

      <Card className="p-4 space-y-4">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={s.emailDigestEnabled}
            onChange={(e) => update({ emailDigestEnabled: e.target.checked })}
          />
          Daily email digest (partner contacts who opt in)
        </label>
        <FormField label="Digest send hour (UTC)">
          <Select
            disabled={!canEdit}
            value={String(s.emailDigestHourUtc)}
            onChange={(e) => update({ emailDigestHourUtc: Number(e.target.value) })}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{h}:00 UTC</option>
            ))}
          </Select>
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Quiet hours start (UTC)">
            <Input
              placeholder="22:00"
              disabled={!canEdit}
              value={s.quietHoursStart ?? ''}
              onChange={(e) => update({ quietHoursStart: e.target.value || null })}
            />
          </FormField>
          <FormField label="Quiet hours end (UTC)">
            <Input
              placeholder="06:00"
              disabled={!canEdit}
              value={s.quietHoursEnd ?? ''}
              onChange={(e) => update({ quietHoursEnd: e.target.value || null })}
            />
          </FormField>
        </div>

        <div className="border-t border-[var(--color-surface-border)] pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
            Mute alert notifications
          </h3>
          <p className="mt-0.5 text-xs text-[var(--color-fg-subtle)]">
            Muted types are still recorded and visible on the Alerts page — they just won&apos;t send
            email or Slack notifications.
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            {ALERT_TYPES.map((t) => {
              const muted = s.mutedAlertTypes.includes(t);
              return (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={muted}
                    data-testid={`mute-${t}`}
                    onChange={(e) =>
                      update({
                        mutedAlertTypes: e.target.checked
                          ? [...s.mutedAlertTypes, t]
                          : s.mutedAlertTypes.filter((x) => x !== t),
                      })
                    }
                  />
                  {ALERT_TYPE_LABEL[t]}
                </label>
              );
            })}
          </div>
        </div>

        {!canEdit ? (
          <p className="text-xs text-[var(--color-fg-muted)]">Admin role required to change tenant settings.</p>
        ) : null}
      </Card>
    </div>
  );
}

/**
 * EDI identity — the tenant's own ISA interchange IDs (ISA06). These drive
 * inbound/outbound classification: an interchange whose sender matches one of
 * these is outbound, one whose receiver matches is inbound. Editable in both
 * SaaS and desktop mode (PATCH /setup accepts ourIsaIds in any mode).
 */
function EdiIdentityCard({ canEdit }: { canEdit: boolean }): JSX.Element {
  const setupKey = useTenantQueryKey('setup');
  const q = useQuery({ queryKey: setupKey, queryFn: () => api.setup.get() });

  if (q.isLoading) return <Skeleton.Table rows={2} columnWidths={['100%']} />;
  if (q.isError || !q.data) {
    return (
      <Card className="p-4">
        <h2 className="text-sm font-semibold">EDI identity</h2>
        <p className="mt-2 text-sm text-[var(--color-fg-muted)]">Could not load EDI identity.</p>
      </Card>
    );
  }
  // Re-seed the editor whenever the saved set changes (e.g. after a save).
  return (
    <EdiIdentityEditor key={q.data.ourIsaIds.join('|')} canEdit={canEdit} initial={q.data.ourIsaIds} />
  );
}

function EdiIdentityEditor({
  canEdit,
  initial,
}: {
  canEdit: boolean;
  initial: string[];
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const setupKey = useTenantQueryKey('setup');
  const [ids, setIds] = useState<string[]>(initial);
  const [draft, setDraft] = useState('');

  const save = useMutation({
    mutationFn: (next: string[]) => api.setup.patch({ ourIsaIds: next }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: setupKey });
      toast.success('EDI identity saved');
    },
    onError: () => toast.error('Could not save EDI identity'),
  });

  function addDraft(): void {
    const value = draft.trim();
    if (!value || ids.includes(value)) {
      setDraft('');
      return;
    }
    setIds([...ids, value]);
    setDraft('');
  }

  const dirty = ids.length !== initial.length || ids.some((id, i) => id !== initial[i]);

  return (
    <Card className="p-4 space-y-4" data-testid="edi-identity-card">
      <div>
        <h2 className="text-sm font-semibold">EDI identity</h2>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          Your own ISA interchange IDs — the ID you send under in ISA06. The hub matches these
          against each interchange&apos;s sender and receiver to classify transactions as inbound or
          outbound. Add every ID you transmit from.
        </p>
      </div>

      {ids.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {ids.map((id) => (
            <li
              key={id}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono text-xs"
            >
              {id}
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`Remove ${id}`}
                  className="text-[var(--color-fg-subtle)] hover:text-[var(--color-error-600)]"
                  onClick={() => setIds(ids.filter((x) => x !== id))}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[var(--color-warn-700)]" data-testid="edi-identity-empty">
          No ISA IDs configured — transactions can&apos;t be classified as inbound or outbound until
          you add at least one.
        </p>
      )}

      {canEdit ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={draft}
              mono
              size="sm"
              placeholder="e.g. 7085892400"
              aria-label="New ISA ID"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addDraft();
                }
              }}
            />
            <button
              type="button"
              className="shrink-0 rounded-md border border-[var(--color-surface-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
              onClick={addDraft}
            >
              Add
            </button>
          </div>
          <button
            type="button"
            disabled={!dirty || save.isPending}
            className="rounded-md bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)] disabled:opacity-50"
            onClick={() => save.mutate(ids)}
          >
            Save EDI identity
          </button>
        </div>
      ) : (
        <p className="text-xs text-[var(--color-fg-muted)]">Admin role required to change EDI identity.</p>
      )}
    </Card>
  );
}
