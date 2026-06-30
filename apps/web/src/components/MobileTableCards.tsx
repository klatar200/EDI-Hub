/**
 * UR2 — card-view fallback for dense tables below the `lg` breakpoint (1024px).
 */
import { Link } from 'react-router-dom';
import type {
  AuditEventRecord,
  LifecycleSummary,
  RawFileRecord,
  RejectionRateRow,
  TradingPartnerRecord,
  TransactionSummary,
} from '@edi/shared';
import { partnerSetupStatus } from '@edi/shared';
import type { UserRole } from '../lib/api.ts';
import { api } from '../lib/api.ts';
import { formatDateTime } from '../lib/formatDateTime.ts';
import { AuditDiffPanel } from './AuditDiffPanel.tsx';
import { Card, Select, StatusPill, rawFileTone, Sparkline } from './ui';
import { EdiTerm } from './EdiTerm.tsx';
import { RequireRole } from '../lib/useRole.tsx';

const LIST_CLASS = 'space-y-2 lg:hidden';

const DIRECTION_LABEL: Record<string, string> = {
  inbound: 'Inbound',
  outbound: 'Outbound',
  unknown: 'Unknown',
};

function Truncated({
  text,
  className = '',
}: {
  text: string | null | undefined;
  className?: string;
}): JSX.Element {
  const value = text ?? '—';
  return (
    <span className={`block truncate ${className}`} title={value === '—' ? undefined : value}>
      {value}
    </span>
  );
}

export function LifecycleMobileCards({ items }: { items: LifecycleSummary[] }): JSX.Element {
  return (
    <ul className={LIST_CLASS} data-testid="lifecycle-mobile-cards">
      {items.map((row) => (
        <li key={row.po}>
          <Card className="p-3">
            <div className="flex items-start justify-between gap-2">
              <Link
                to={`/lifecycle/${encodeURIComponent(row.po)}`}
                className="truncate font-medium text-[var(--color-fg)] underline decoration-[var(--color-surface-border)] underline-offset-2"
                title={row.po}
              >
                {row.po}
              </Link>
              {row.openAlertCount > 0 ? (
                <StatusPill tone="error" size="sm" withDot>{row.openAlertCount}</StatusPill>
              ) : null}
            </div>
            <Truncated text={row.partnerDisplayName} className="mt-1 text-sm text-[var(--color-fg-muted)]" />
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--color-fg-muted)]">
              <span>{row.received} docs</span>
              {row.missing > 0 ? <span className="text-[var(--color-warn-700)]">{row.missing} missing</span> : null}
              {row.hasParseError ? <span className="text-[var(--color-warn-700)]">Parse error</span> : null}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function TransactionMobileCards({ items }: { items: TransactionSummary[] }): JSX.Element {
  return (
    <ul className={LIST_CLASS} data-testid="transaction-mobile-cards">
      {items.map((t) => (
        <li key={t.id}>
          <Card className="p-3">
            <div className="flex items-center justify-between gap-2">
              <EdiTerm term={t.transactionSetId} className="font-mono text-sm font-semibold" />
              {t.status ? (
                <StatusPill tone={rawFileTone(t.status)} size="sm" withDot>{t.status}</StatusPill>
              ) : null}
            </div>
            <Link
              to={`/transactions/${t.id}`}
              className="mt-1 block truncate text-sm font-medium text-[var(--color-fg)] underline decoration-[var(--color-surface-border)] underline-offset-2"
              title={t.poNumber ?? t.invoiceNumber ?? t.controlNumber}
            >
              {t.poNumber ?? t.invoiceNumber ?? t.controlNumber}
            </Link>
            <p className="mt-1 truncate text-xs text-[var(--color-fg-muted)]" title={`${t.senderId ?? '—'} → ${t.receiverId ?? '—'}`}>
              {DIRECTION_LABEL[t.direction] ?? t.direction}
              {' · '}
              {t.senderId ?? '—'} → {t.receiverId ?? '—'}
            </p>
            {t.ingestedAt ? (
              <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                {formatDateTime(t.ingestedAt, { compact: true })}
              </p>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function IngestionMobileCards({
  items,
  isOps,
  onReparse,
}: {
  items: RawFileRecord[];
  isOps: boolean;
  onReparse: (id: string) => void;
}): JSX.Element {
  return (
    <ul className={LIST_CLASS} data-testid="ingestion-mobile-cards">
      {items.map((r) => (
        <li key={r.id}>
          <Card className="p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-sm" title={r.isaControlNumber ?? undefined}>
                {r.isaControlNumber ?? '—'}
              </span>
              <StatusPill tone={rawFileTone(r.status)} size="sm" withDot>{r.status}</StatusPill>
            </div>
            <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
              {r.source}
              {' · '}
              {formatDateTime(r.ingestedAt, { compact: true })}
            </p>
            {r.errorMessage ? (
              <p className="mt-1 truncate text-xs text-[var(--color-error-700)]" title={r.errorMessage}>
                {r.errorMessage}
              </p>
            ) : null}
            <div className="mt-2 flex gap-3">
              <button
                type="button"
                aria-label={`View raw file ${r.isaControlNumber ?? r.id}`}
                className="text-xs text-[var(--color-brand-600)] hover:underline"
                onClick={() => void api.rawContent(r.id).then((t) => {
                  const blob = new Blob([t], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const opened = window.open(url, '_blank');
                  if (!opened) URL.revokeObjectURL(url);
                  else setTimeout(() => URL.revokeObjectURL(url), 60_000);
                })}
              >
                Raw
              </button>
              {isOps && (r.status === 'PARSE_ERROR' || r.status === 'FAILED' || r.status === 'RECEIVED') ? (
                <button
                  type="button"
                  aria-label={`Retry parse for ${r.isaControlNumber ?? r.id}`}
                  className="text-xs text-[var(--color-brand-600)] hover:underline"
                  data-testid={`reparse-mobile-${r.id}`}
                  onClick={() => onReparse(r.id)}
                >
                  Retry parse
                </button>
              ) : null}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function PartnerSetupBadge({ partner }: { partner: TradingPartnerRecord }): JSX.Element {
  const setup = partnerSetupStatus(partner);
  const title = setup.gaps.length
    ? setup.gaps.map((g) => `• ${g.label}: ${g.hint}`).join('\n')
    : 'All recommended settings are configured.';
  return (
    <span data-testid={`partner-setup-${partner.id}`} title={title}>
      {setup.status === 'ready' ? (
        <StatusPill tone="success" size="sm">Ready</StatusPill>
      ) : (
        <StatusPill
          tone={setup.status === 'error' ? 'error' : setup.status === 'warn' ? 'warn' : 'info'}
          size="sm"
          withDot
        >
          {setup.gaps.length} gap{setup.gaps.length === 1 ? '' : 's'}
        </StatusPill>
      )}
    </span>
  );
}

export function PartnerMobileCards({
  items,
  isAdmin,
  onEdit,
}: {
  items: TradingPartnerRecord[];
  isAdmin: boolean;
  onEdit: (partner: TradingPartnerRecord) => void;
}): JSX.Element {
  return (
    <ul className={LIST_CLASS} data-testid="partner-mobile-cards">
      {items.map((p) => (
        <li key={p.id}>
          <Card className="p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="truncate font-semibold text-[var(--color-fg)]" title={p.displayName}>
                {p.displayName}
              </span>
              <StatusPill tone={p.status === 'active' ? 'success' : 'neutral'} withDot size="sm">
                {p.status}
              </StatusPill>
            </div>
            <p className="mt-1 truncate font-mono text-xs text-[var(--color-fg-muted)]" title={p.isaSenderIds.join(', ')}>
              ISA: {p.isaSenderIds.join(', ') || '—'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <PartnerSetupBadge partner={p} />
              {p.connectivity?.channel ? (
                <StatusPill tone="brand" size="sm">{p.connectivity.channel}</StatusPill>
              ) : null}
            </div>
            {isAdmin ? (
              <button
                type="button"
                className="mt-3 text-sm text-[var(--color-brand-600)] hover:underline"
                onClick={() => onEdit(p)}
              >
                Edit
              </button>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function UserMobileCards({
  items,
  selfId,
  onRoleChange,
  onRemove,
  rolePending,
}: {
  items: Array<{ id: string; email: string; displayName: string | null; role: UserRole }>;
  selfId: string | undefined;
  onRoleChange: (id: string, role: UserRole) => void;
  onRemove: (id: string, email: string) => void;
  rolePending: boolean;
}): JSX.Element {
  return (
    <ul className={LIST_CLASS} data-testid="user-mobile-cards">
      {items.map((u) => {
        const isSelf = selfId === u.id;
        return (
          <li key={u.id}>
            <Card className="p-3">
              <Truncated text={u.email} className="font-mono text-sm" />
              <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{u.displayName ?? '—'}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <RequireRole
                  role="admin"
                  fallback={<span className="text-sm text-[var(--color-fg-muted)]">{u.role}</span>}
                >
                  <Select
                    size="sm"
                    data-testid={`role-select-${u.id}`}
                    value={u.role}
                    disabled={isSelf && rolePending}
                    onChange={(e) => onRoleChange(u.id, e.target.value as UserRole)}
                  >
                    {(['viewer', 'ops', 'admin'] as UserRole[]).map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </Select>
                </RequireRole>
                <RequireRole role="admin">
                  {isSelf ? (
                    <span className="text-xs text-[var(--color-fg-subtle)]">(you)</span>
                  ) : (
                    <button
                      type="button"
                      data-testid={`remove-user-${u.id}`}
                      className="text-xs text-[var(--color-error-700)] hover:underline"
                      onClick={() => onRemove(u.id, u.email)}
                    >
                      Remove
                    </button>
                  )}
                </RequireRole>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

export function AuditMobileCards({
  items,
  expandedId,
  onToggle,
}: {
  items: AuditEventRecord[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}): JSX.Element {
  return (
    <ul className={LIST_CLASS} data-testid="audit-mobile-cards">
      {items.map((row) => (
        <li key={row.id}>
          <Card className="p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-xs">{row.action}</span>
              <button
                type="button"
                className="text-xs text-[var(--color-brand-600)]"
                aria-expanded={expandedId === row.id}
                data-testid={`audit-expand-${row.id}`}
                onClick={() => onToggle(row.id)}
              >
                {expandedId === row.id ? 'Hide' : 'Details'}
              </button>
            </div>
            <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
              {formatDateTime(row.createdAt, { compact: true })}
            </p>
            <p className="mt-1 truncate text-xs text-[var(--color-fg-muted)]" title={row.targetId}>
              {row.targetType} · {row.targetId.slice(0, 8)}…
            </p>
            {expandedId === row.id ? (
              <div className="mt-3 border-t border-[var(--color-surface-border)] pt-3">
                <AuditDiffPanel row={row} />
              </div>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function MetricsMobileCards({ rows }: { rows: RejectionRateRow[] }): JSX.Element {
  return (
    <ul className={LIST_CLASS} data-testid="metrics-mobile-cards">
      {rows.map((row) => (
        <li key={row.partner}>
          <Card className="p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-sm" title={row.partner}>{row.partner}</span>
              <span className="font-mono text-sm tabular-nums">{(row.rate * 100).toFixed(1)}%</span>
            </div>
            <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
              {row.rejected} rejected / {row.total} acked
            </p>
            <div className="mt-2">
              <Sparkline.RateBar value={row.rate} />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export interface DashboardFailureRow {
  id: string;
  isaControlNumber: string | null;
  status: string;
  errorMessage: string | null;
  ingestedAt: string;
}

export function DashboardFailureMobileCards({ items }: { items: DashboardFailureRow[] }): JSX.Element {
  return (
    <ul className={LIST_CLASS} data-testid="dashboard-failure-mobile-cards">
      {items.map((f) => (
        <li key={f.id}>
          <Card className="p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm">{f.isaControlNumber ?? '—'}</span>
              <StatusPill tone="error" size="sm">{f.status}</StatusPill>
            </div>
            <Truncated text={f.errorMessage} className="mt-1 text-xs text-[var(--color-error-700)]" />
            <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
              {formatDateTime(f.ingestedAt, { compact: true })}
            </p>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export interface DashboardPartnerHealthRow {
  partnerId: string;
  displayName: string;
  lastIngestAt: string | null;
  lastAckAt: string | null;
  rejectionRate30d: number;
  missingAckCount: number;
  openAlertCount: number;
}

export function DashboardPartnerHealthMobileCards({
  items,
}: {
  items: DashboardPartnerHealthRow[];
}): JSX.Element {
  return (
    <ul className={LIST_CLASS} data-testid="dashboard-partner-health-mobile-cards">
      {items.map((row) => (
        <li key={row.partnerId}>
          <Card className="p-3">
            <Link
              to="/partners-config"
              className="truncate font-medium text-[var(--color-brand-600)] hover:underline"
              title={row.displayName}
            >
              {row.displayName}
            </Link>
            <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
              Last ingest: {formatDateTime(row.lastIngestAt, { compact: true })}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="tabular-nums">Rejection {(row.rejectionRate30d * 100).toFixed(1)}%</span>
              {row.openAlertCount > 0 ? (
                <Link to={`/?hasAlerts=true&partnerId=${row.partnerId}`}>
                  <StatusPill tone="error" size="sm" withDot>{row.openAlertCount} alerts</StatusPill>
                </Link>
              ) : null}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function SearchRawFileMobileCards({ items }: { items: RawFileRecord[] }): JSX.Element {
  return (
    <ul className={LIST_CLASS} data-testid="search-raw-mobile-cards">
      {items.map((r) => (
        <li key={r.id}>
          <Card className="p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm">{r.isaControlNumber ?? '—'}</span>
              <StatusPill tone={rawFileTone(r.status)} withDot size="sm">{r.status}</StatusPill>
            </div>
            <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
              {r.source} · {formatDateTime(r.ingestedAt, { compact: true })}
            </p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
