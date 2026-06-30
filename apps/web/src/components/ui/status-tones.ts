/**
 * Canonical status-tone semantics (UI build plan S1).
 *
 * One place that maps every domain status/severity to a `StatusPill` tone, so
 * a color means the same thing everywhere. New status surfaces should add a
 * mapper here and import it — do **not** hand-roll inline tone ternaries or
 * per-file `Record<…, StatusTone>` maps (those drift).
 *
 * Tone meanings (the contract every mapper below honors):
 *   success  (green)  — healthy / complete / acknowledged / confirmed / active-OK
 *   error    (red)    — failure / rejected / critical / an open problem
 *   warn     (amber)  — needs attention / pending / overdue-soon / expected-but-missing
 *   info     (blue)   — informational / in-progress / inbound / received
 *   brand    (indigo) — a category accent (e.g. outbound), NOT a health signal
 *   neutral  (grey)   — inert / disabled / unknown / no signal
 *
 * `rawFileTone` lives in `StatusPill.tsx` (it shipped first); it follows the
 * same contract and is re-exported from the ui barrel alongside these.
 */
import type {
  AlertSeverity,
  AlertStatus,
  LifecycleStatus,
  LifecycleDirection,
  OutboundStage,
  PartnerStatus,
  PartnerSetupSeverity,
} from '@edi/shared';
import type { StatusTone } from './StatusPill.tsx';

/** Alert severity → tone. info/warning/critical escalate blue→amber→red. */
export function alertSeverityTone(severity: AlertSeverity): StatusTone {
  switch (severity) {
    case 'critical': return 'error';
    case 'warning':  return 'warn';
    case 'info':     return 'info';
    default:         return 'neutral';
  }
}

/** Alert lifecycle status → tone. An open (active) alert is a problem. */
export function alertStatusTone(status: AlertStatus): StatusTone {
  switch (status) {
    case 'active':       return 'error';
    case 'acknowledged': return 'success';
    case 'resolved':     return 'neutral';
    default:             return 'neutral';
  }
}

/** A document's lifecycle status → tone. */
export function lifecycleStatusTone(status: LifecycleStatus): StatusTone {
  switch (status) {
    case 'acknowledged':     return 'success';
    case 'rejected':         return 'error';
    case 'expected_missing': return 'warn';
    case 'received':         return 'neutral';
    default:                 return 'neutral';
  }
}

/** Transaction direction → tone. Direction is a category, not a health signal,
 *  so outbound uses the brand accent rather than success/error. */
export function directionTone(direction: LifecycleDirection): StatusTone {
  switch (direction) {
    case 'inbound':  return 'info';
    case 'outbound': return 'brand';
    case 'unknown':  return 'neutral';
    default:         return 'neutral';
  }
}

/** Outbound delivery stage → tone. generated→transmitted→confirmed. */
export function outboundStageTone(stage: OutboundStage): StatusTone {
  switch (stage) {
    case 'confirmed':   return 'success';
    case 'transmitted': return 'info';
    case 'generated':   return 'warn';
    default:            return 'neutral';
  }
}

/** Ingestion channel health → tone. */
export function channelHealthTone(status: string): StatusTone {
  switch (status) {
    case 'running': return 'success';
    case 'error':   return 'error';
    default:        return 'neutral';
  }
}

/** Trading-partner status → tone. */
export function partnerStatusTone(status: PartnerStatus): StatusTone {
  return status === 'active' ? 'success' : 'neutral';
}

/** Partner setup-completeness severity (or 'ready') → tone. Mirrors
 *  `partnerSetupStatus(...).status` from @edi/shared. */
export function partnerSetupTone(status: 'ready' | PartnerSetupSeverity): StatusTone {
  switch (status) {
    case 'ready': return 'success';
    case 'error': return 'error';
    case 'warn':  return 'warn';
    case 'info':  return 'info';
    default:      return 'neutral';
  }
}
