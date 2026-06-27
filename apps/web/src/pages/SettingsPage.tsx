/**
 * PS-6 — Settings hub: theme, SLA countdown, stale-traffic window, digest.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TenantSettingsPatch } from '@edi/shared';
import { api } from '../lib/api.ts';
import { useTheme } from '../lib/useTheme.tsx';
import { ThemeToggle } from '../components/ui/ThemeToggle.tsx';
import { PageHeader, Card, FormField, Input, Select, ErrorState, Skeleton } from '../components/ui';
import { useToast } from '../lib/useToast.tsx';

export function SettingsPage(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { mode } = useTheme();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() });

  const patch = useMutation({
    mutationFn: (input: TenantSettingsPatch) => api.settings.patch(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      toast.show('Settings saved');
    },
    onError: () => toast.show('Could not save settings', 'error'),
  });

  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError || !q.data) return <ErrorState message="Could not load settings." onRetry={() => void q.refetch()} />;

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
        {!canEdit ? (
          <p className="text-xs text-[var(--color-fg-muted)]">Admin role required to change tenant settings.</p>
        ) : null}
      </Card>
    </div>
  );
}
