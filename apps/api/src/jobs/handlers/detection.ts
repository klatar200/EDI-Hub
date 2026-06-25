/**
 * Desktop track D2 Sprint 2 — shared detection job handler.
 *
 * One source of truth for the Phase 7 detection pass. Two callers:
 *
 *   1. The DB-backed job worker (`apps/api/src/index.ts` registers this
 *      handler at boot). The `Job.payload` carries `{ tenantId?, asOf? }` so
 *      the scheduler can request a specific tenant or a backdated run.
 *
 *   2. The one-shot CLI runner (`apps/api/src/scripts/run-detection.ts`).
 *      The CLI builds its own deps from the env, calls this same factory,
 *      and invokes the returned handler with a payload — proving the
 *      "no duplicated logic" invariant in the D2 Sprint 2 scorecard.
 *
 * Behavior:
 *   - Pins the tenant context to `payload.tenantId` (or `PILOT_TENANT_ID`
 *     when omitted, matching the pre-D2 CLI default).
 *   - Runs `detectMissingAcks` and `detectRejectionSpikes` against the
 *     configured `asOf` clock (`new Date()` by default).
 *   - Wraps the work in `tenantContext.run(...)` so the Prisma extension's
 *     missing-context guard is satisfied.
 *   - Throws on unexpected errors so the job queue records them as a
 *     failure / dead-letter per the retry budget.
 */
import type { PrismaClient } from '@prisma/client';
import { tenantContext, PILOT_TENANT_ID } from '@edi/db';
import type { JobHandler } from '../interface.js';
import {
  detectMissingAcks,
  detectRejectionSpikes,
  type DetectionResult,
} from '../../services/detection.js';
import type { NotifierDeps } from '../../services/notifier.js';

/** Logger contract the handler uses for progress lines. */
export interface DetectionLogger {
  info(o: unknown, msg?: string): void;
}

const noopLogger: DetectionLogger = { info: () => {} };

export interface DetectionHandlerDeps {
  prisma: PrismaClient;
  notifier: NotifierDeps;
  /** Phase 7 Sprint 3 — suppression window applied to new alerts on creation. */
  suppressionMinutes: number;
  /** Injected for tests / cron drift; defaults to `() => new Date()`. */
  now?: () => Date;
  logger?: DetectionLogger;
}

/** Payload contract the producer must satisfy. All fields optional so an
 *  empty `{}` is a valid "run detection for the pilot tenant against now". */
export interface DetectionJobPayload {
  /** Tenant to scope the run. Defaults to PILOT_TENANT_ID for backward
   *  compatibility with the pre-D2 CLI. */
  tenantId?: string;
  /** ISO-8601 instant the pass should treat as "now". Useful for backfills
   *  and deterministic tests. Defaults to the handler's clock. */
  asOf?: string;
}

/** Outcome surface exposed for the CLI runner so it can print counts. */
export interface DetectionPassResult {
  missing: DetectionResult;
  spike: DetectionResult;
}

/**
 * Run one detection pass directly. The CLI uses this; the job handler wraps
 * it. Kept separate so an inline test can call it without going through the
 * job queue.
 */
export async function runDetectionPass(
  deps: DetectionHandlerDeps,
  payload: DetectionJobPayload = {},
): Promise<DetectionPassResult> {
  const now = payload.asOf ? new Date(payload.asOf) : (deps.now ?? (() => new Date()))();
  const tenantId = payload.tenantId ?? PILOT_TENANT_ID;
  const opts = {
    notifier: deps.notifier,
    suppressionMinutes: deps.suppressionMinutes,
  };

  return tenantContext.run({ tenantId }, async () => {
    const missing = await detectMissingAcks(deps.prisma, now, opts);
    deps.logger?.info?.(
      { tenantId, asOf: now.toISOString(), emitted: missing.emitted, notified: missing.notified },
      'detection: MISSING_ACK pass complete',
    );
    const spike = await detectRejectionSpikes(deps.prisma, now, opts);
    deps.logger?.info?.(
      { tenantId, asOf: now.toISOString(), emitted: spike.emitted, notified: spike.notified },
      'detection: REJECTION_RATE_SPIKE pass complete',
    );
    return { missing, spike };
  });
}

/**
 * Job-queue handler factory. Returns a function that the DB worker invokes
 * when it claims a `detection`-named job. The factory captures the deps;
 * the returned handler only depends on the queue-supplied payload.
 */
export function createDetectionHandler(deps: DetectionHandlerDeps): JobHandler {
  const logger = deps.logger ?? noopLogger;
  return async (rawPayload: unknown): Promise<void> => {
    const payload = parsePayload(rawPayload);
    await runDetectionPass({ ...deps, logger }, payload);
  };
}

/** Defensive: the queue stores payloads as JSON strings, so by the time they
 *  reach us they're already a `unknown` JS value. Pull only the documented
 *  fields and ignore extras — extra keys aren't an error, just future. */
function parsePayload(raw: unknown): DetectionJobPayload {
  if (raw == null || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: DetectionJobPayload = {};
  if (typeof r.tenantId === 'string' && r.tenantId.length > 0) out.tenantId = r.tenantId;
  if (typeof r.asOf === 'string' && r.asOf.length > 0) out.asOf = r.asOf;
  return out;
}

/** Stable name the producer enqueues against. Exporting it as a constant
 *  prevents the typo class of bug ("detect" vs "detection"). */
export const DETECTION_JOB_NAME = 'detection';
