/**
 * Desktop track D2 Sprint 1 — job queue factory.
 *
 * Picks the active backend via `JOB_BACKEND`. Today only `'db'` is supported
 * (see DESKTOP_SPRINT_PLAN.md D2 — "no Redis required anywhere"). The env
 * switch is preserved so a future `'bullmq'` (or other) implementation can
 * be slotted in without touching every call site.
 *
 * The factory returns ONE object that implements both `JobQueue` and
 * `JobWorker`. Callers can hold a producer reference (just `enqueue`) or a
 * worker reference (register + start + shutdown) without coupling to the
 * concrete class.
 */
import type { PrismaClient } from '@prisma/client';
import { DbJobAdapter, type DbJobQueueOptions, type JobLogger } from './db-adapter.js';
import type { JobQueue, JobWorker } from './interface.js';

export type JobBackend = 'db';

export function resolveJobBackend(
  env: NodeJS.ProcessEnv = process.env,
): JobBackend {
  const raw = (env.JOB_BACKEND ?? 'db').toLowerCase().trim();
  if (raw === '' || raw === 'db') return 'db';
  throw new Error(
    `Unsupported JOB_BACKEND='${env.JOB_BACKEND ?? ''}'. ` +
      "Only 'db' is supported in D2 Sprint 1.",
  );
}

export interface JobsFactoryOptions extends DbJobQueueOptions {
  /** Optional override; otherwise resolved from `process.env.JOB_BACKEND`. */
  backend?: JobBackend;
  logger?: JobLogger;
}

/**
 * Build a job queue + worker for the current process. The returned object
 * is BOTH a `JobQueue` (for producers) and a `JobWorker` (for the
 * bootstrap that registers handlers + starts the poller).
 */
export function createJobsAdapter(
  prisma: PrismaClient,
  opts: JobsFactoryOptions = {},
): JobQueue & JobWorker {
  const backend = opts.backend ?? resolveJobBackend();
  switch (backend) {
    case 'db':
      return new DbJobAdapter(prisma, opts);
    default: {
      // Exhaustive: TS narrows `backend` to `never` here. Belt-and-braces
      // runtime check for the case where JOB_BACKEND was hand-set to
      // something the type system doesn't see.
      const _exhaustive: never = backend;
      throw new Error(`Unhandled JOB_BACKEND: ${String(_exhaustive)}`);
    }
  }
}
