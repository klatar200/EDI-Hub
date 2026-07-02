/**
 * Desktop track D8 Sprint 2 — five-step first-run wizard.
 *
 * Works in the Electron window and in a LAN browser (folder path is typed
 * manually when `window.desktop` is unavailable). Do not gate the whole flow
 * on `window.runtime` — only the folder-picker affordance is desktop-specific.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PartnerConfigInput } from '@edi/shared';
import { CLERK_DASHBOARD_URL } from '@edi/shared';
import { Card } from '../components/ui/Card.tsx';
import { FormField, Input } from '../components/ui/forms.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';

const STEPS = ['Welcome', 'Clerk', 'Drop folder', 'Partner', 'Telemetry'] as const;

export function FirstRunWizardPage(): JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [clerkVerified, setClerkVerified] = useState(false);
  const [clerkError, setClerkError] = useState<string | null>(null);
  const [dropFolder, setDropFolder] = useState('');
  const [folderError, setFolderError] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState('Acme Corp');
  const [partnerIsa, setPartnerIsa] = useState('ACME');
  const [ourIsaId, setOurIsaId] = useState('');
  const [partnerError, setPartnerError] = useState<string | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);

  const setupKey = useTenantQueryKey('setup');
  const setupQ = useQuery({
    queryKey: setupKey,
    queryFn: () => api.setup.get(),
    staleTime: 5_000,
  });

  const patchSetup = useMutation({
    mutationFn: (input: Parameters<typeof api.setup.patch>[0]) => api.setup.patch(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: setupKey }),
  });

  const verifyAuth = useMutation({
    mutationFn: () => api.setup.verifyAuth(),
    onSuccess: () => {
      setClerkVerified(true);
      setClerkError(null);
    },
    onError: () => setClerkError('Auth check failed. Confirm Clerk redirect URIs, then try again.'),
  });

  const createPartner = useMutation({
    mutationFn: (input: PartnerConfigInput) => api.partnersConfig.create(input),
  });

  async function pickFolder(): Promise<void> {
    if (window.desktop?.pickDropFolder) {
      const chosen = await window.desktop.pickDropFolder();
      if (chosen) setDropFolder(chosen);
      return;
    }
    setFolderError('Native picker is only available in the EDI Hub desktop app. Enter the server path below.');
  }

  async function saveDropFolder(): Promise<boolean> {
    const path = dropFolder.trim();
    if (!path) {
      setFolderError('Choose or enter a folder path.');
      return false;
    }
    setFolderError(null);
    try {
      await patchSetup.mutateAsync({ dropFolderPath: path });
      return true;
    } catch {
      setFolderError('Could not save the folder path.');
      return false;
    }
  }

  async function savePartner(): Promise<boolean> {
    const name = partnerName.trim();
    const isa = partnerIsa.trim();
    const ours = ourIsaId.trim();
    if (!name || !isa || !ours) {
      setPartnerError('Display name, partner ISA ID, and your ISA ID are required.');
      return false;
    }
    setPartnerError(null);
    try {
      await patchSetup.mutateAsync({ ourIsaIds: [ours] });
      await createPartner.mutateAsync({
        displayName: name,
        isaSenderIds: [isa],
        isaReceiverIds: [],
        supportedSets: ['850', '855', '856', '860', '875', '880', '810', '997'],
      });
      return true;
    } catch (err) {
      setPartnerError(err instanceof Error ? err.message : 'Could not save partner settings.');
      return false;
    }
  }

  async function finishWizard(telemetryEnabled: boolean): Promise<void> {
    setTelemetryError(null);
    try {
      await patchSetup.mutateAsync({ telemetryEnabled, firstRunComplete: true });
      await qc.invalidateQueries({ queryKey: setupKey });
      navigate('/', { replace: true });
    } catch {
      setTelemetryError('Could not save your choice. Try again.');
    }
  }

  const redirectOrigins = setupQ.data?.server?.redirectOrigins ?? [];

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-bg)] p-6">
      <Card className="w-full max-w-xl">
        <Card.Header>
          <div>
            <Card.Title>Set up EDI Hub</Card.Title>
            <Card.Description>
              Step {step + 1} of {STEPS.length} — {STEPS[step]}
            </Card.Description>
          </div>
        </Card.Header>
        <Card.Content className="space-y-6">
          {step === 0 ? (
            <div className="space-y-4">
              <p className="text-sm text-[var(--color-fg)]">
                EDI Hub receives your trading partners&apos; X12 files, parses them into structured
                data, and gives you one place to monitor transactions, troubleshoot errors, and
                stitch purchase-order lifecycles.
              </p>
              <p className="text-sm text-[var(--color-fg-muted)]">
                This short wizard gets your first file uploaded. Let&apos;s get your first file in.
              </p>
              <button
                type="button"
                className="rounded-md bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)]"
                onClick={() => setStep(1)}
              >
                Get started
              </button>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              <p className="text-sm text-[var(--color-fg)]">
                Add these URLs to your Clerk application&apos;s{' '}
                <strong>Allowed redirect URIs</strong> so sign-in works from this server
                (including other machines on your LAN):
              </p>
              {setupQ.isLoading ? (
                <div role="status" aria-busy="true" aria-label="Loading server addresses" className="space-y-2 rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] p-3">
                  <Skeleton.Row width="70%" height="h-3" />
                  <Skeleton.Row width="55%" height="h-3" />
                </div>
              ) : (
                <ul className="rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] p-3 font-mono text-xs">
                  {redirectOrigins.map((origin) => (
                    <li key={origin} className="flex items-center justify-between gap-2 py-0.5">
                      <span>{origin}</span>
                      <button
                        type="button"
                        className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--color-brand-600)] hover:underline"
                        onClick={() => void navigator.clipboard.writeText(origin)}
                      >
                        Copy
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {redirectOrigins.length > 0 ? (
                <button
                  type="button"
                  className="text-sm text-[var(--color-brand-600)] hover:underline"
                  onClick={() => void navigator.clipboard.writeText(redirectOrigins.join('\n'))}
                >
                  Copy all LAN URLs
                </button>
              ) : null}
              <p className="text-sm text-[var(--color-fg-muted)]">
                <a
                  href={CLERK_DASHBOARD_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--color-brand-600)] hover:underline"
                >
                  Open Clerk dashboard
                </a>
                {' '}→ Configure → Paths → Allowed redirect URIs.
              </p>
              {clerkError ? (
                <p className="text-xs text-[var(--color-error-700)]">{clerkError}</p>
              ) : null}
              {clerkVerified || setupQ.data?.clerkRedirectVerified ? (
                <p className="text-xs text-[var(--color-success-700)]">Clerk auth verified for this server.</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={verifyAuth.isPending}
                  className="rounded-md border border-[var(--color-surface-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
                  onClick={() => void verifyAuth.mutate()}
                >
                  I&apos;ve done this
                </button>
                <button
                  type="button"
                  disabled={!clerkVerified && !setupQ.data?.clerkRedirectVerified}
                  className="rounded-md bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)] disabled:opacity-50"
                  onClick={() => setStep(2)}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <p className="text-sm text-[var(--color-fg)]">
                Choose a folder on this machine. Copy EDI files here and the hub receives them
                automatically.
              </p>
              <FormField label="Drop folder path" error={folderError}>
                <div className="flex gap-2">
                  <Input
                    value={dropFolder}
                    onChange={(e) => setDropFolder(e.target.value)}
                    placeholder="C:\EDI\incoming or /data/edi/incoming"
                    mono
                  />
                  {window.desktop?.pickDropFolder ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-[var(--color-surface-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
                      onClick={() => void pickFolder()}
                    >
                      Browse…
                    </button>
                  ) : null}
                </div>
              </FormField>
              {!window.desktop?.pickDropFolder ? (
                <p className="text-xs text-[var(--color-fg-subtle)]">
                  Enter the folder path as seen by the EDI Hub server (required when signing in from
                  another machine&apos;s browser).
                </p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md border border-[var(--color-surface-border)] px-4 py-2 text-sm"
                  onClick={() => setStep(1)}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={patchSetup.isPending}
                  className="rounded-md bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)] disabled:opacity-50"
                  onClick={() => void saveDropFolder().then((ok) => ok && setStep(3))}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <p className="text-sm text-[var(--color-fg)]">
                Add your first trading partner. You can refine SLA windows and contacts later on the
                Partners page.
              </p>
              <FormField label="Display name" required error={partnerError && !partnerName.trim() ? 'Required' : undefined}>
                <Input value={partnerName} onChange={(e) => setPartnerName(e.target.value)} />
              </FormField>
              <FormField label="ISA sender ID" required hint="The ID your partner uses in ISA06 when they send you files.">
                <Input value={partnerIsa} onChange={(e) => setPartnerIsa(e.target.value)} mono />
              </FormField>
              <FormField
                label="Your ISA ID"
                required
                hint="The ID you use in ISA06 when you send files to partners. Used to classify inbound vs outbound."
              >
                <Input
                  value={ourIsaId}
                  onChange={(e) => setOurIsaId(e.target.value)}
                  placeholder="7085892400"
                  mono
                />
              </FormField>
              {partnerError ? (
                <p className="text-xs text-[var(--color-error-700)]">{partnerError}</p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md border border-[var(--color-surface-border)] px-4 py-2 text-sm"
                  onClick={() => setStep(2)}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={createPartner.isPending}
                  className="rounded-md bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)] disabled:opacity-50"
                  onClick={() => void savePartner().then((ok) => ok && setStep(4))}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-4">
              <p className="text-sm text-[var(--color-fg)]">
                Help us improve EDI Hub by sending anonymous crash reports?
              </p>
              <p className="text-xs text-[var(--color-fg-muted)]">
                No telemetry is sent until you answer. You can change this later from Help → Privacy
                Settings (coming in a future release).
              </p>
              {telemetryError ? (
                <p className="text-xs text-[var(--color-error-700)]">{telemetryError}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={patchSetup.isPending}
                  className="rounded-md bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)] disabled:opacity-50"
                  onClick={() => void finishWizard(true)}
                >
                  Yes, send crash reports
                </button>
                <button
                  type="button"
                  disabled={patchSetup.isPending}
                  className="rounded-md border border-[var(--color-surface-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
                  onClick={() => void finishWizard(false)}
                >
                  No thanks
                </button>
              </div>
            </div>
          ) : null}
        </Card.Content>
      </Card>
    </div>
  );
}
