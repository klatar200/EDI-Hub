/**
 * Phase 8 Sprint 1 — outbound-stage UI primitives.
 *
 * - StageBadge: compact "transmitted" / "confirmed" / "generated" chip used in
 *   the lifecycle row and anywhere we surface an outbound transaction at a
 *   glance.
 * - StageTimeline: three-step Generated → Transmitted → Confirmed timeline
 *   with checkmarks per reached stage and timestamps when known. Renders on
 *   the transaction detail page for outbound transactions only.
 *
 * Both components return null when there's no signal (`stage === null`), so
 * callers can render unconditionally without sprinkling guards.
 */
import type { LifecycleStatus, OutboundStage } from '@edi/shared';
import { StatusPill, type StatusTone } from './ui';

const STAGE_LABEL: Record<OutboundStage, string> = {
  generated: 'Generated',
  transmitted: 'Transmitted',
  confirmed: 'Confirmed',
};

// Generated-but-not-transmitted is an alarming state (we'd only ever see it
// once Gate A unlocks the ERP webhook). Amber signals "in flight, watch this."
// Transmitted-but-not-confirmed is the normal in-flight state for outbound —
// info-blue reads as "underway, awaiting partner." Confirmed = partner sent
// a 997 accepting it.
const STAGE_TONE: Record<OutboundStage, StatusTone> = {
  generated: 'warn',
  transmitted: 'info',
  confirmed: 'success',
};

export function StageBadge({ stage }: { stage: OutboundStage | null }): JSX.Element | null {
  if (!stage) return null;
  return (
    <span data-testid={`stage-badge-${stage}`}>
      <StatusPill tone={STAGE_TONE[stage]} size="sm">{STAGE_LABEL[stage]}</StatusPill>
    </span>
  );
}

/** Transmission step only — on the lifecycle row we surface confirmation separately. */
function transmissionStage(stage: OutboundStage): OutboundStage {
  return stage === 'confirmed' ? 'transmitted' : stage;
}

function ConfirmationBadge({ confirmed }: { confirmed: boolean }): JSX.Element {
  return (
    <span data-testid={confirmed ? 'confirmation-badge-confirmed' : 'confirmation-badge-not-confirmed'}>
      <StatusPill tone={confirmed ? 'success' : 'neutral'} size="sm" withDot>
        {confirmed ? 'Confirmed' : 'Not Confirmed'}
      </StatusPill>
    </span>
  );
}

/**
 * Lifecycle row chips for outbound docs: transmission stage first, then partner
 * confirmation. Replaces the misleading "Received" ack-status pill on outbound
 * rows that already show a transmission stage.
 */
export function OutboundLifecycleBadges({
  stage,
  status,
}: {
  stage: OutboundStage;
  status: LifecycleStatus;
}): JSX.Element {
  if (status === 'rejected') {
    return (
      <>
        <StageBadge stage={transmissionStage(stage)} />
        <StatusPill tone="error" size="sm" withDot>
          Rejected
        </StatusPill>
      </>
    );
  }

  const confirmed = stage === 'confirmed' || status === 'acknowledged';
  return (
    <>
      <StageBadge stage={transmissionStage(stage)} />
      <ConfirmationBadge confirmed={confirmed} />
    </>
  );
}

interface StageTimelineProps {
  stage: OutboundStage | null;
  generatedAt: string | null;
  transmittedAt: string | null;
  confirmedAt: string | null;
}

const STAGE_ORDER: OutboundStage[] = ['generated', 'transmitted', 'confirmed'];

/** Map a stage to its reached-ness given the current furthest stage. */
function isReached(target: OutboundStage, current: OutboundStage | null): boolean {
  if (!current) return false;
  return STAGE_ORDER.indexOf(target) <= STAGE_ORDER.indexOf(current);
}

function fmt(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export function StageTimeline(props: StageTimelineProps): JSX.Element | null {
  const { stage, generatedAt, transmittedAt, confirmedAt } = props;
  if (!stage) return null;

  // Generated and transmitted carry the same timestamp in v1 (Gate A heuristic),
  // so the UI is honest about it: we show the same timestamp but a separate
  // step. Once Gate A unlocks the ERP webhook, the two will diverge naturally.
  const stamps: Record<OutboundStage, string | null> = {
    generated: generatedAt,
    transmitted: transmittedAt,
    confirmed: confirmedAt,
  };

  return (
    <section
      data-testid="stage-timeline"
      className="rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] p-4 shadow-xs"
    >
      <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">Outbound lifecycle</h2>
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STAGE_ORDER.map((s) => {
          const reached = isReached(s, stage);
          return (
            <li
              key={s}
              data-testid={`stage-step-${s}${reached ? '-reached' : ''}`}
              className={`flex items-start gap-3 rounded-md border p-3 text-sm ${
                reached
                  ? 'border-[var(--color-surface-border)] bg-[var(--color-surface-muted)]'
                  : 'border-dashed border-[var(--color-surface-border)] bg-[var(--color-surface-card)] text-[var(--color-fg-subtle)]'
              }`}
            >
              <span
                aria-hidden
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  reached
                    ? 'bg-[var(--color-success-500)] text-white'
                    : 'bg-[var(--color-surface-border)] text-[var(--color-fg-subtle)]'
                }`}
              >
                {reached ? '✓' : ''}
              </span>
              <div>
                <div className={reached ? 'font-medium text-[var(--color-fg)]' : 'font-medium'}>
                  {STAGE_LABEL[s]}
                </div>
                <div className="text-xs text-[var(--color-fg-muted)] tabular-nums">{fmt(stamps[s])}</div>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-[var(--color-fg-subtle)]">
        v1 heuristic: <span className="font-mono">generated</span> and{' '}
        <span className="font-mono">transmitted</span> share a timestamp until ERP
        integration provides an upstream generation signal.
      </p>
    </section>
  );
}
