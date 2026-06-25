/**
 * Desktop track D2 Sprint 1 — job queue interface.
 *
 * The hub needs a way to schedule background work (today: Phase 7 missing-ack
 * detection; future: retention sweeps, partner health checks). The SaaS plan
 * originally called for BullMQ + Redis; the desktop track avoids that
 * dependency entirely by using a Postgres-backed `Job` table (which falls
 * back to SQLite for local dev — Prisma abstracts the difference). See the
 * D2 intro in DESKTOP_SPRINT_PLAN.md for the "no Redis required anywhere"
 * decision.
 *
 * The interface is intentionally minimal: `enqueue`, `register`, `start`,
 * `shutdown`. Two implementations live alongside this file:
 *
 *   - `db-adapter.ts` — the only adapter that ships today. Polls the Job
 *     table on an interval and runs registered handlers in-process.
 *   - (future) `bullmq-adapter.ts` — left unimplemented in Sprint 1. If we
 *     ever want Redis-backed scheduling on the SaaS side, the slot is here.
 *
 * The factory (`factory.ts`) picks one at boot via `JOB_BACKEND`.
 */

/**
 * A registered handler runs in-process when a matching job is claimed. The
 * payload is whatever the producer enqueued; handlers are responsible for
 * validating its shape. Throwing flips the job to 'failed' (or 'dead' after
 * the retry budget is exhausted).
 *
 * Handlers MUST be idempotent. The retry loop re-runs the same payload on
 * the same row; if a handler's effects aren't safe to repeat, that's a bug
 * in the handler, not the queue.
 */
export type JobHandler = (payload: unknown) => Promise<void>;

/** Producer-side surface. Routes / services call this to schedule work. */
export interface JobQueue {
  /**
   * Schedule a job. Returns when the row is durably written; handler
   * execution happens later on whichever worker polls next.
   *
   * @param name    Stable handler key (e.g. `"detection"`). Must match a
   *                registered handler at the time the worker tries to run
   *                it; an unknown name flips the row to `'failed'` with a
   *                clear error.
   * @param payload Anything JSON-serialisable. The queue stringifies it.
   * @param opts    `delayMs` to defer execution; 0 / omitted = "run on next
   *                poll".
   */
  enqueue(jobName: string, payload: unknown, opts?: { delayMs?: number }): Promise<void>;
  /** Best-effort flush + connection cleanup. Idempotent. */
  shutdown(): Promise<void>;
}

/** Consumer-side surface. The bootstrap registers handlers and starts the
 *  poll loop. */
export interface JobWorker {
  /**
   * Register a handler for a given job name. Must be called BEFORE
   * `start()` for that name to fire; registering after start is fine but
   * any jobs polled before registration just see "unknown handler" and
   * fail.
   */
  register(jobName: string, handler: JobHandler): void;
  /** Begin polling on whatever cadence the adapter chooses. Idempotent. */
  start(): void;
  /**
   * Stop polling and wait for the in-flight job (at most one for the
   * single-poller DB adapter) to finish. Idempotent.
   */
  shutdown(): Promise<void>;
}
