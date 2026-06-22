/**
 * UI Phase Sprint 6.2 — Legacy StatusBadge shim.
 *
 * Pre-UI-phase callers used <StatusBadge status={r.status} />. Every page
 * now uses <StatusPill /> + rawFileTone() directly. This shim forwards
 * to the token-aware primitive so any straggler import keeps working.
 *
 * Prefer importing { StatusPill, rawFileTone } from '../components/ui'
 * going forward.
 */
import type { RawFileStatus } from '@edi/shared';
import { StatusPill, rawFileTone } from './ui';

export function StatusBadge({ status }: { status: RawFileStatus | null }): JSX.Element {
  if (!status) return <span className="text-[var(--color-fg-subtle)]">—</span>;
  return (
    <StatusPill tone={rawFileTone(status)} withDot>
      {status}
    </StatusPill>
  );
}
