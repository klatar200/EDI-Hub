/**
 * PS-12 F61 — Help hub: glossary, release notes, LAN URL, install docs.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CLERK_DASHBOARD_URL,
  LAN_INSTALL_DOCS_URL,
  preferredLanOrigin,
  RELEASES_URL,
} from '@edi/shared';
import { PageHeader, Card, Skeleton } from '../components/ui';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';

export function HelpPage(): JSX.Element {
  const setupKey = useTenantQueryKey('setup');
  const setupQ = useQuery({ queryKey: setupKey, queryFn: () => api.setup.get(), retry: false });
  const origins = setupQ.data?.server?.redirectOrigins ?? [];
  const lanUrl = preferredLanOrigin(origins);
  const isDesktop = setupQ.data?.desktopMode === true;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Help"
        subtitle="Documentation, release notes, and LAN setup for this hub."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4 space-y-2">
          <h2 className="text-sm font-semibold">Transaction sets</h2>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Plain-English guide to 850–997 and Tier B sets (860, 875, 880) in the order-to-cash loop.
          </p>
          <Link to="/help/transaction-sets" className="text-sm text-[var(--color-brand-600)] hover:underline">
            Open glossary →
          </Link>
        </Card>
        <Card className="p-4 space-y-2">
          <h2 className="text-sm font-semibold">What&apos;s new</h2>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Release notes and changelog on GitHub.
          </p>
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            data-testid="help-releases-link"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            View releases →
          </a>
        </Card>
        {isDesktop ? (
          <Card className="p-4 space-y-3 md:col-span-2" data-testid="help-lan-section">
            <h2 className="text-sm font-semibold">LAN access</h2>
            <p className="text-sm text-[var(--color-fg-muted)]">
              Share this URL with teammates on your network. Add every listed origin to Clerk
              allowed redirect URIs (see first-run wizard or{' '}
              <a href={CLERK_DASHBOARD_URL} target="_blank" rel="noreferrer" className="text-[var(--color-brand-600)] hover:underline">
                Clerk dashboard
              </a>
              ).
            </p>
            {setupQ.isLoading ? (
              <div role="status" aria-busy="true" aria-label="Loading server addresses" className="space-y-1.5">
                <Skeleton.Row width="60%" height="h-5" />
                <Skeleton.Row width="45%" height="h-3" />
              </div>
            ) : (
              <>
                <p className="rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] px-3 py-2 font-mono text-sm">
                  {lanUrl}
                </p>
                {origins.length > 1 ? (
                  <ul className="text-xs text-[var(--color-fg-muted)]">
                    {origins.map((o) => (
                      <li key={o} className="font-mono">{o}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded border border-[var(--color-surface-border)] px-3 py-1 text-sm hover:bg-[var(--color-surface-muted)]"
                    data-testid="copy-lan-url"
                    onClick={() => void navigator.clipboard.writeText(lanUrl)}
                  >
                    Copy LAN URL
                  </button>
                  {origins.length > 1 ? (
                    <button
                      type="button"
                      className="rounded border border-[var(--color-surface-border)] px-3 py-1 text-sm hover:bg-[var(--color-surface-muted)]"
                      data-testid="copy-all-lan-urls"
                      onClick={() => void navigator.clipboard.writeText(origins.join('\n'))}
                    >
                      Copy all origins
                    </button>
                  ) : null}
                </div>
              </>
            )}
            <a
              href={LAN_INSTALL_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              data-testid="help-lan-docs-link"
              className="inline-block text-sm text-[var(--color-brand-600)] hover:underline"
            >
              LAN install guide →
            </a>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
