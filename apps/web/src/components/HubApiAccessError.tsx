import { ApiCallError } from '../lib/api.ts';

function errorDetail(err: unknown): { code?: string; message: string } {
  if (err instanceof ApiCallError) {
    return {
      code: err.errorCode(),
      message: err.errorMessage() ?? err.message,
    };
  }
  if (err instanceof Error) return { message: err.message };
  return { message: 'The hub API rejected this session.' };
}

/** Shown when Clerk is signed in but GET /api/me returns 403/401. */
export function HubApiAccessError({ error }: { error: unknown }): JSX.Element {
  const { code, message } = errorDetail(error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-bg)] p-6">
      <div className="max-w-lg space-y-3 rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] p-6 text-sm shadow-sm">
        <h1 className="text-base font-semibold text-[var(--color-fg)]">Cannot connect to the hub API</h1>
        <p className="text-[var(--color-fg-muted)]">{message}</p>
        {code ? (
          <p className="font-mono text-xs text-[var(--color-fg-subtle)]">Error code: {code}</p>
        ) : null}
        {code === 'SELECT_ORGANIZATION' ? (
          <p className="text-[var(--color-fg-muted)]">
            Use the organization switcher in the header to pick an active organization, then reload.
          </p>
        ) : null}
        {(code === 'TENANT_NOT_PROVISIONED' || code === 'USER_NOT_PROVISIONED') ? (
          <p className="text-[var(--color-fg-muted)]">
            Restart the desktop app once — it syncs Clerk on boot. If this persists, sign out and sign in again.
          </p>
        ) : null}
      </div>
    </div>
  );
}
