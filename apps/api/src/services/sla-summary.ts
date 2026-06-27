/**
 * PB-4 F33 — SLA countdown label for lifecycle rows.
 */
import type { LifecycleEvent, PartnerSlaWindow } from '@edi/shared';

export interface SlaSummary {
  label: string;
  breached: boolean;
}

export function computeSlaSummary(
  events: LifecycleEvent[],
  slaWindows: PartnerSlaWindow[],
  now: Date = new Date(),
): SlaSummary | null {
  if (slaWindows.length === 0) return null;

  let worst: (SlaSummary & { score: number }) | null = null;

  for (const e of events) {
    if (e.kind !== 'transaction' || e.direction !== 'outbound') continue;
    if (!e.ingestedAt) continue;
    if (e.ackedByTransactionId) continue;
    if (e.status === 'rejected') continue;

    const sla = slaWindows.find(
      (w) => w.setId === e.transactionSetId && w.direction === e.direction,
    );
    if (!sla) continue;

    const elapsedM = Math.floor((now.getTime() - new Date(e.ingestedAt).getTime()) / 60_000);
    const remaining = sla.withinMinutes - elapsedM;
    const breached = remaining < 0;
    const label = breached
      ? `${e.transactionSetId} ack overdue ${Math.abs(remaining)}m`
      : `${e.transactionSetId} ack due in ${remaining}m`;
    const score = breached ? Math.abs(remaining) : -remaining;

    if (!worst || score > worst.score) {
      worst = { label, breached, score };
    }
  }

  return worst ? { label: worst.label, breached: worst.breached } : null;
}

export function shouldShowSlaCountdown(
  globalEnabled: boolean,
  partnerEnabled: boolean,
): boolean {
  return globalEnabled || partnerEnabled;
}
