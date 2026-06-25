/**
 * Desktop track D2 Sprint 1 — DB-backed job queue + worker.
 *
 * Polls the `jobs` table for due work, runs registered handlers in-process,
 * and updates row status to `done` / `failed` / `dead`. Works against both
 * Postgres (SaaS + desktop installer) and SQLite (local dev) — Prisma
 * abstracts the difference.
 *
 * Design choices and why:
 *
 *   - **Single in-process poller, no row-level lock.** Sprint 1 ships exactly
 *     one API process per install (SaaS pod, desktop installer, local dev).
 *     A `SELECT ... FOR UPDATE SKIP LOCKED` would buy us nothing today, so
 *     we keep it simple: pick one due row, claim it with a conditional
 *     update (`updateMany` filtering on `status='pending'`), and walk away
 *     if someone else beat us. If we ever scale to multiple workers, the
 *     same conditional-update strategy still works as a poor-man's lock —
 *     each worker either wins the row or moves on.
 *
 *   - **Retry budget: 3 attempts with exponential backoff (10s, 40s, 90s).**
 *     A failed handler resets `status='pending'` and bumps `runAfter` so the
 *     next poll picks it up later. After 3 failures the row goes `'dead'`
 *     and stays in the table for forensic inspection — a future sprint can
 *     add a route to list / requeue dead jobs.
 *
 *   - **Tenant context.** The Job model is in `TENANT_EXEMPT_MODELS`, so the
 *     extension lets reads/writes through without a context. Handlers that
 *     need a tenant scope must `tenantContext.run({ tenantId, ... }, ...)`
 *     around their own work — the payload should carry whatever scope info
 *     the handler needs.
 *
 *   - **Errors during the poll itself** (DB unreachable, bug in the loop)
 *     are logged and the poller continues. We never let the worker die
 *     silently — a stopped worker means missed alerts.
 */
import type { PrismaClient } from '@prisma/client';
import type { JobHandler, JobQueue, JobWorker } from './interface.js';

/** Backoff schedule, in milliseconds. Index `attempt - 1`. */
const RETRY_DELAYS_MS = [10_000, 40_000, 90_000];

/** Max attempts before a row is parked at `'dead'`. */
const MAX_ATTEMPTS = 3;

/** Default poll cadence — see DESKTOP_SPRINT_PLAN.md D2 Sprint 1 step 4. */
const DEFAULT_POLL_INTERVAL_MS = 30_000;

/**
 * Minimal pino-shaped logger surface so this module doesn't import Fastify's
 * Logger type. The API passes `app.log`; tests pass a noop.
 */
export interface JobLogger {
  info(o: unknown, msg?: string): void;
  warn(o: unknown, msg?: string): void;
  error(o: unknown, msg?: string): void;
}

const noopLogger: JobLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface DbJobQueueOptions {
  /** How often the worker scans for due jobs. Default 30 000ms. */
  pollIntervalMs?: number;
  /** Injected for tests. Defaults to `Date.now`. */
  now?: () => Date;
  /** Injected for tests. Defaults to `setInterval`/`clearInterval` etc. */
  timers?: {
    setInterval: (cb: () => void, ms: number) => NodeJS.Timeout;
    clearInterval: (h: NodeJS.Timeout) => void;
  };
  logger?: JobLogger;
}

/**
 * One adapter object that implements BOTH `JobQueue` (producer) and
 * `JobWorker` (consumer). Callers can hold a `JobQueue` reference for
 * enqueue-only code paths and a `JobWorker` reference for the bootstrap.
 */
export class DbJobAdapter implements JobQueue, JobWorker {
  private readonly handlers = new Map<string, JobHandler>();
  private pollHandle: NodeJS.Timeout | null = null;
  private polling = false; // re-entrancy guard inside one tick
  private inFlight: Promise<void> | null = null;
  private shutdownRequested = false;

  private readonly pollIntervalMs: number;
  private readonly now: () => Date;
  private readonly timers: NonNullable<DbJobQueueOptions['timers']>;
  private readonly logger: JobLogger;

  constructor(
    private readonly prisma: PrismaClient,
    opts: DbJobQueueOptions = {},
  ) {
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.now = opts.now ?? (() => new Date());
    this.timers = opts.timers ?? {
      setInterval: (cb, ms) => setInterval(cb, ms),
      clearInterval: (h) => clearInterval(h),
    };
    this.logger = opts.logger ?? noopLogger;
  }

  // ─── JobQueue ────────────────────────────────────────────────

  async enqueue(
    jobName: string,
    payload: unknown,
    opts: { delayMs?: number } = {},
  ): Promise<void> {
    const delayMs = Math.max(0, opts.delayMs ?? 0);
    const runAfter = new Date(this.now().getTime() + delayMs);
    await this.prisma.job.create({
      data: {
        name: jobName,
        payload: JSON.stringify(payload ?? null),
        runAfter,
        // status, attempts, error default per the schema.
      },
    });
  }

  // ─── JobWorker ──────────────────────────────────────────────

  register(jobName: string, handler: JobHandler): void {
    this.handlers.set(jobName, handler);
  }

  start(): void {
    if (this.pollHandle !== null) return;
    this.shutdownRequested = false;
    // Schedule the first tick at the cadence, NOT immediately — tests that
    // want to drive ticks deterministically use `runOnce()`.
    this.pollHandle = this.timers.setInterval(
      () => void this.tick(),
      this.pollIntervalMs,
    );
  }

  async shutdown(): Promise<void> {
    this.shutdownRequested = true;
    if (this.pollHandle !== null) {
      this.timers.clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    // Let any in-flight job finish; do NOT abandon mid-flight (would risk a
    // half-applied state on the next start).
    if (this.inFlight) {
      try {
        await this.inFlight;
      } catch {
        /* errors are logged in runJob; swallow here so shutdown always returns */
      }
    }
  }

  // ─── Internals (also exported on the class for tests) ────────

  /**
   * Test-only / startup-only helper: run one poll-and-claim pass synchronously.
   * Production code calls `start()` which schedules `tick()` on an interval.
   */
  async runOnce(): Promise<void> {
    await this.tick();
  }

  /** One pass of the poll loop. Reentrancy-safe. */
  private async tick(): Promise<void> {
    if (this.polling || this.shutdownRequested) return;
    this.polling = true;
    try {
      const job = await this.claimNextDueJob();
      if (!job) return;
      this.inFlight = this.runJob(job);
      await this.inFlight;
    } catch (err) {
      this.logger.error({ err }, 'job-queue: poll loop error');
    } finally {
      this.inFlight = null;
      this.polling = false;
    }
  }

  /**
   * Try to claim the oldest due `pending` job. Returns the claimed row, or
   * `null` if nothing was due. The claim is atomic via `updateMany` on a
   * filter that includes the current status — if a competing worker beat
   * us to it, the update touches 0 rows and we return null without erroring.
   */
  private async claimNextDueJob(): Promise<ClaimedJob | null> {
    // Use the index on (status, runAfter) to find one due row.
    const candidate = await this.prisma.job.findFirst({
      where: { status: 'pending', runAfter: { lte: this.now() } },
      orderBy: { runAfter: 'asc' },
      select: { id: true, name: true, payload: true, attempts: true },
    });
    if (!candidate) return null;

    // Try to claim it. The compound filter (id + status='pending') is the
    // poor-man's row lock — a competing worker that already claimed this
    // row will have flipped status off 'pending', so our updateMany sees 0
    // rows and we return null.
    //
    // We DON'T bump attempts here; that happens in runJob's failure branch
    // so a successful run doesn't waste a retry slot.
    const claim = await this.prisma.job.updateMany({
      where: { id: candidate.id, status: 'pending' },
      data: { status: 'running' },
    });
    if (claim.count === 0) return null;

    return {
      id: candidate.id,
      name: candidate.name,
      payload: candidate.payload,
      attempts: candidate.attempts,
    };
  }

  /** Decode payload, look up handler, run it, write the outcome. */
  private async runJob(job: ClaimedJob): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      await this.markFailed(
        job,
        `No handler registered for job name '${job.name}'`,
      );
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(job.payload) as unknown;
    } catch (err) {
      await this.markFailed(
        job,
        `Job payload is not valid JSON: ${(err as Error).message}`,
      );
      return;
    }

    try {
      await handler(payload);
      await this.prisma.job.update({
        where: { id: job.id },
        data: { status: 'done', error: null },
      });
    } catch (err) {
      await this.markFailed(job, (err as Error).message ?? String(err));
    }
  }

  /**
   * Apply retry / dead-letter logic. We just ran an attempt, so the new
   * attempt count is `attempts + 1`. If that's still under the budget we
   * push the runAfter forward by the backoff for this attempt and flip
   * status back to `'pending'`; otherwise we park the row at `'dead'`.
   */
  private async markFailed(job: ClaimedJob, message: string): Promise<void> {
    const newAttempts = job.attempts + 1;
    if (newAttempts >= MAX_ATTEMPTS) {
      await this.prisma.job.update({
        where: { id: job.id },
        data: { status: 'dead', attempts: newAttempts, error: message },
      });
      this.logger.error(
        { jobId: job.id, name: job.name, attempts: newAttempts },
        'job-queue: job moved to dead-letter',
      );
      return;
    }
    const delayMs = RETRY_DELAYS_MS[newAttempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
    const runAfter = new Date(this.now().getTime() + delayMs);
    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'pending',
        attempts: newAttempts,
        error: message,
        runAfter,
      },
    });
    this.logger.warn(
      { jobId: job.id, name: job.name, attempts: newAttempts, retryInMs: delayMs },
      'job-queue: job failed, will retry',
    );
  }
}

/** Internal projection of the Job row carried through the runner. */
interface ClaimedJob {
  id: string;
  name: string;
  payload: string;
  attempts: number;
}

/** Convenience: typed constants for tests / docs. */
export const __testing = {
  RETRY_DELAYS_MS,
  MAX_ATTEMPTS,
  DEFAULT_POLL_INTERVAL_MS,
} as const;
