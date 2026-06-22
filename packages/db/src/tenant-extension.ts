/**
 * Phase 9 Sprint 1.2 — Prisma tenant extension.
 *
 * The structural guarantee that cross-tenant data is unreachable from normal
 * code paths. Every query against a multi-tenant model is automatically
 * filtered by the active `tenantId` (from `tenantContext`); every write
 * automatically injects it, including nested creates.
 *
 *   - No active tenant context → throw (loud failure in development).
 *   - Active context with `bypass: true` → pass through unchanged.
 *   - Multi-tenant model with no tenant filter in `where` → injected.
 *   - Create / upsert with no `tenantId` in `data` → injected, recursively for
 *     nested `create` / `createMany`.
 *
 * What this is NOT:
 *   - It is NOT a substitute for Sprint 6's adversarial verification. The
 *     extension is the code path *normal* writers walk; Sprint 6 proves it
 *     holds under direct DB inspection and forged-claim probes.
 *   - It is NOT a substitute for thinking. Authors of new tables MUST add
 *     them to MULTI_TENANT_MODELS or the extension will silently let them
 *     through. The unit test in `tenant-extension.test.ts` enumerates the
 *     expected model list and fails when the schema gains a model that isn't
 *     either tenant-scoped or explicitly opted out.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { tenantContext } from './tenant-context.js';

/**
 * Models that carry `tenantId`. Keep in sync with `schema.prisma`. The
 * Sprint 6 verification test will compare this set against the actual Prisma
 * DMMF and fail on drift.
 */
export const MULTI_TENANT_MODELS = new Set<string>([
  'TradingPartner',
  'RawFile',
  'Interchange',
  'FunctionalGroup',
  'Transaction',
  'Segment',
  'Element',
  'Alert',
  'User',
  'AuditEvent',
]);

/** Models that are intentionally NOT tenant-scoped. The Tenant table itself
 *  obviously can't be; future system tables (e.g. feature flags) go here. */
export const TENANT_EXEMPT_MODELS = new Set<string>(['Tenant']);

/** Query operations whose `args.where` should be tenant-filtered when present
 *  or fabricated when absent. */
const FILTER_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy',
  'update', 'updateMany', 'updateManyAndReturn',
  'delete', 'deleteMany',
]);

/** Create-like operations whose `args.data` should be injected with tenantId
 *  (and recursively for nested creates inside relation fields). */
const CREATE_OPS = new Set([
  'create', 'createMany', 'createManyAndReturn', 'upsert',
]);

/**
 * Minimum-shape view of the DMMF that the injector actually needs. Avoids a
 * dependency on the full `Prisma.DMMF.Datamodel` type, which has had moving
 * fields between Prisma 5.x and 6.x (notably `indexes` showing up at the top
 * level). `Prisma.dmmf.datamodel` is structurally compatible.
 */
export interface MinimalDmmf {
  models: ReadonlyArray<{
    name: string;
    fields: ReadonlyArray<{
      name: string;
      kind: string;
      type: string;
      relationName?: string;
    }>;
  }>;
}

/**
 * Walk `data` and inject `tenantId` everywhere a multi-tenant row is being
 * created. Handles:
 *   - Single objects: `{ field: 'x' }` → `{ field: 'x', tenantId }`.
 *   - Arrays: `[{ ... }, { ... }]`.
 *   - Nested relation creates: `{ rel: { create: { ... } } }` and
 *     `{ rel: { create: [...] } }` and `{ rel: { createMany: { data: [...] } } }`.
 *   - upsert's `{ create, update }`.
 *
 * `dmmf` is the Prisma DMMF used to look up which fields are relations and
 * the model they point at, so we only inject into multi-tenant relations.
 *
 * Exported under `__testing` for unit tests; the production callers go
 * through the `query` hook below.
 */
export function injectInData(
  data: unknown,
  modelName: string,
  tenantId: string,
  dmmf: MinimalDmmf,
): unknown {
  if (data == null) return data;
  if (Array.isArray(data)) {
    return data.map((d) => injectInData(d, modelName, tenantId, dmmf));
  }
  if (typeof data !== 'object') return data;

  const model = dmmf.models.find((m) => m.name === modelName);
  if (!model) return data;
  const isMultiTenant = MULTI_TENANT_MODELS.has(modelName);

  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };

  // Inject tenantId on the row itself (if multi-tenant and not already set).
  if (isMultiTenant && out.tenantId === undefined) {
    out.tenantId = tenantId;
  }

  // Walk relations. Each Prisma relation field on the model exposes
  // `relationName` + `type` (the related model name).
  for (const field of model.fields) {
    if (field.kind !== 'object' || !field.relationName) continue;
    const relValue = out[field.name];
    if (relValue == null || typeof relValue !== 'object') continue;
    const relatedModelName = field.type;
    const relOps = relValue as Record<string, unknown>;

    if (relOps.create !== undefined) {
      relOps.create = injectInData(relOps.create, relatedModelName, tenantId, dmmf);
    }
    if (relOps.createMany !== undefined && typeof relOps.createMany === 'object') {
      const cm = relOps.createMany as Record<string, unknown>;
      if (cm.data !== undefined) {
        cm.data = injectInData(cm.data, relatedModelName, tenantId, dmmf);
      }
    }
    if (relOps.upsert !== undefined && typeof relOps.upsert === 'object') {
      const up = relOps.upsert as Record<string, unknown>;
      if (up.create !== undefined) {
        up.create = injectInData(up.create, relatedModelName, tenantId, dmmf);
      }
    }
    if (relOps.connectOrCreate !== undefined && typeof relOps.connectOrCreate === 'object') {
      const cc = relOps.connectOrCreate as Record<string, unknown>;
      if (cc.create !== undefined) {
        cc.create = injectInData(cc.create, relatedModelName, tenantId, dmmf);
      }
    }
    out[field.name] = relOps;
  }

  return out;
}

/** Merge a tenantId filter into an existing `where` (or fabricate one).
 *  Idempotent: if the caller already specified the same tenantId we leave
 *  it alone; if they specified a *different* tenantId, we throw — that's
 *  almost certainly a bug. */
export function injectInWhere(where: unknown, tenantId: string): Record<string, unknown> {
  const base = (where && typeof where === 'object' ? where : {}) as Record<string, unknown>;
  if (base.tenantId !== undefined && base.tenantId !== tenantId) {
    throw new Error(
      `Tenant context (${tenantId}) conflicts with explicit where.tenantId (${String(base.tenantId)}). ` +
      'Use tenantContext.bypass(...) if a cross-tenant query is genuinely intended.',
    );
  }
  return { ...base, tenantId };
}

/** Build the extended client. Apply once at construction time. */
export function withTenantExtension<T extends PrismaClient>(client: T): T {
  // Prisma's $extends API lives on every PrismaClient instance. The DMMF is
  // exposed via `Prisma.dmmf` (generated alongside the client). We coerce to
  // our minimal shape because the official `Prisma.DMMF.Datamodel` type has
  // had churn between 5.x and 6.x (the `indexes` field was added in 6.x at
  // the top level and isn't present on `Prisma.dmmf.datamodel`'s return).
  const dmmf: MinimalDmmf = Prisma.dmmf.datamodel as unknown as MinimalDmmf;

  const extended = (client as PrismaClient).$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // Exempt models pass through unchanged. Tenant CRUD is admin code
          // and must run through tenantContext.bypass() (which sets the flag
          // we honour below); the exempt set is just an optimization.
          if (!model || TENANT_EXEMPT_MODELS.has(model)) {
            return query(args);
          }
          const ctx = tenantContext.current();
          if (!ctx) {
            // No context = developer forgot the wrapper. Loud failure beats
            // silent cross-tenant data access every time.
            throw new Error(
              `Prisma ${model}.${operation} called without a tenant context. ` +
              'Wrap your request in tenantContext.run({ tenantId }, ...).',
            );
          }
          if (ctx.bypass) {
            return query(args);
          }
          if (!MULTI_TENANT_MODELS.has(model)) {
            // Not in the multi-tenant set AND not exempt — unknown model. Fail
            // loudly so the author has to make an explicit choice in code.
            throw new Error(
              `Model ${model} is not in MULTI_TENANT_MODELS or TENANT_EXEMPT_MODELS. ` +
              'Decide in tenant-extension.ts whether it should be tenant-scoped.',
            );
          }

          const a = (args ?? {}) as Record<string, unknown>;
          if (FILTER_OPS.has(operation)) {
            a.where = injectInWhere(a.where, ctx.tenantId);
          }
          if (CREATE_OPS.has(operation)) {
            // `createMany.data` is an array; `create.data` is an object.
            // Both flow through the same recursive injector — it handles both.
            if (a.data !== undefined) {
              a.data = injectInData(a.data, model, ctx.tenantId, dmmf);
            }
            // upsert: also has `where` (for the lookup) and `update` (no
            // tenant injection — update already FILTER_OPS-covered? No,
            // upsert is in CREATE_OPS only). Tighten both.
            if (operation === 'upsert') {
              a.where = injectInWhere(a.where, ctx.tenantId);
              if (a.update !== undefined) {
                // No-op for tenantId: an upsert update path shouldn't change tenant.
                // The extension simply does nothing — we trust the writer here.
              }
              if (a.create !== undefined) {
                a.create = injectInData(a.create, model, ctx.tenantId, dmmf);
              }
            }
          }
          return query(a);
        },
      },
    },
  });
  // $extends returns a structurally-compatible client; cast back to T so
  // callers keep their typed model access without a refactor.
  return extended as unknown as T;
}
