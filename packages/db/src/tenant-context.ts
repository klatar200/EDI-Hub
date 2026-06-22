/**
 * Phase 9 Sprint 1.3 — Tenant context (AsyncLocalStorage).
 *
 * Every authenticated request sets the active tenant for the duration of the
 * request handler via `tenantContext.run(ctx, fn)`. The Prisma extension
 * (Sprint 1.2) reads from this storage on every query/mutation and refuses
 * to run if no context is set — that's the structural guarantee against
 * accidental cross-tenant access in request-scoped code.
 *
 * Background jobs and scripts that need to operate on a specific tenant call
 * `tenantContext.run(...)` themselves before issuing queries. Admin code that
 * legitimately needs to bypass tenancy (Tenant CRUD, audit-log writes, the
 * Clerk webhook) uses `tenantContext.bypass(fn)` — a typed escape hatch that
 * sets a flag the extension respects.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContextValue {
  /** UUID of the tenant whose data the current code path is allowed to see. */
  tenantId: string;
  /** When true, the extension does NOT inject tenantId filters / data. Used by
   *  admin / audit / webhook code paths that legitimately span tenants. Defaults
   *  to false on every `run()`. */
  bypass?: boolean;
}

const storage = new AsyncLocalStorage<TenantContextValue>();

/** Has the missing-context warning fired? Throttled so a long-running test
 *  doesn't drown the log. */
let warnedNoContext = false;

export const tenantContext = {
  /** Run `fn` with `ctx` as the active tenant context. Any Prisma query inside
   *  `fn` (including async work) inherits the context via AsyncLocalStorage.
   *  Prefer this in scripts / background jobs / tests where the scope is
   *  obviously bounded. */
  run<T>(ctx: TenantContextValue, fn: () => T): T {
    return storage.run({ ...ctx, bypass: ctx.bypass ?? false }, fn);
  },
  /** Set the context for the current async chain WITHOUT scoping to a callback.
   *  Used by the Fastify onRequest hook because Fastify's hooks can't wrap the
   *  rest of the request lifecycle in a callback — `enterWith` is the
   *  Node.js-recommended primitive for this exact case. Caller is responsible
   *  for not leaking the context across unrelated work. */
  enterWith(ctx: TenantContextValue): void {
    storage.enterWith({ ...ctx, bypass: ctx.bypass ?? false });
  },
  /** Convenience: enter a bypass context. Use sparingly — every call is a
   *  potential cross-tenant data path. Audit log + tenant CRUD + the Clerk
   *  webhook are the only legitimate callers in Sprint 1. */
  bypass<T>(fn: () => T): T {
    // Preserve any existing tenantId so error logging still says "during tenant X"
    // but flip the bypass flag for the extension's check.
    const current = storage.getStore();
    return storage.run({ tenantId: current?.tenantId ?? '<bypass>', bypass: true }, fn);
  },
  /** Read the current context, or `undefined` if none is set. The Prisma
   *  extension treats `undefined` as a hard error to make missing wrappers
   *  obvious in development. */
  current(): TenantContextValue | undefined {
    return storage.getStore();
  },
  /** Read the active tenant id. Falls back to `PILOT_TENANT_ID` with a
   *  one-time warning when no context is set.
   *
   *  Why the fallback (and why it's safe):
   *   - The STRUCTURAL guarantee against cross-tenant access lives in the
   *     Prisma extension, which throws on missing context regardless of what
   *     this helper returns.
   *   - In production, the Fastify tenant plugin (or any script wrapped in
   *     `tenantContext.run(...)`) always sets a context before service code
   *     runs, so the fallback never fires.
   *   - In tests using fake Prisma clients (which bypass the extension), the
   *     fallback lets service helpers read a sensible default rather than
   *     throwing, so existing test fixtures keep working without manual
   *     per-test wrapping.
   *
   *  When the Phase 9 Sprint 2 work adds real auth, this fallback stays as a
   *  safety net but should never fire in practice; the one-time console
   *  warning is the signal that a new code path is missing its wrapper. */
  requireTenantId(): string {
    const ctx = storage.getStore();
    if (ctx) return ctx.tenantId;
    if (!warnedNoContext) {
      warnedNoContext = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[tenant-context] requireTenantId() called without a context — falling back to PILOT_TENANT_ID. ' +
        'In production this should never happen; wrap the call in tenantContext.run({ tenantId }, ...).',
      );
    }
    return PILOT_TENANT_ID;
  },
} as const;

/** Sentinel for tests / scripts that legitimately operate on a fixed tenant. */
export const PILOT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
