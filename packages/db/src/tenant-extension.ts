/**
 * Phase 9 Sprint 1.2 — Prisma tenant extension.
 *
 * The structural guarantee that cross-tenant data is unreachable from normal
 * code paths. Every query against a multi-tenant model is automatically
 * filtered by the active `tenantId` (from `tenantContext`); every write
 * automatically injects it, including nested creates.
 *
 *   - No active tenant context -> throw (loud failure in development).
 *   - Active context with `bypass: true` -> pass through unchanged.
 *   - Multi-tenant model with no tenant filter in `where` -> injected.
 *   - Create / upsert with no `tenantId` in `data` -> injected, recursively for
 *     nested `create` / `createMany`.
 *
 * Desktop track D1 Sprint 3 - when DATABASE_PROVIDER=sqlite, the same hook
 * also JSON-stringifies the four `String[]` columns on write and JSON-parses
 * them on read, so the API code keeps seeing `string[]` regardless of which
 * physical column shape the active provider uses.
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
// Node's ESM loader cannot extract named exports from a CommonJS module
// when `verbatimModuleSyntax: true` keeps the import shape literal at
// compile time. `@prisma/client` is CJS, so we import the default
// (= module.exports) and destructure `Prisma` from it. Works the same
// in `tsx` dev runs and in the packaged Electron install.
import prismaPkg from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
const { Prisma } = prismaPkg;
import { tenantContext } from './tenant-context.js';
import { resolveProvider } from './provider.js';
import {
  deserializeArrayFields,
  serializeArrayFields,
} from './array-serialization.js';

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
  'LifecycleNote',
]);

export const TENANT_EXEMPT_MODELS = new Set<string>(['Tenant', 'Job']);

const FILTER_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy',
  'update', 'updateMany', 'updateManyAndReturn',
  'delete', 'deleteMany',
]);

const CREATE_OPS = new Set([
  'create', 'createMany', 'createManyAndReturn', 'upsert',
]);

/** D1 Sprint 3 - operations whose `data` payload may carry array-typed
 *  columns we have to JSON-stringify before they hit SQLite. `upsert` is
 *  handled separately because it has both `create` and `update` sub-objects. */
const DATA_WRITE_OPS = new Set([
  'create', 'createMany', 'createManyAndReturn',
  'update', 'updateMany', 'updateManyAndReturn',
]);

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

  if (isMultiTenant && out.tenantId === undefined) {
    out.tenantId = tenantId;
  }

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

export function withTenantExtension<T extends PrismaClient>(client: T): T {
  const dmmf: MinimalDmmf = Prisma.dmmf.datamodel as unknown as MinimalDmmf;

  // Desktop track D1 Sprint 3 - capture the provider at construction time so
  // we don't read process.env on the hot path. Postgres is a hard no-op.
  const sqliteMode = resolveProvider() === 'sqlite';

  const extended = (client as PrismaClient).$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || TENANT_EXEMPT_MODELS.has(model)) {
            // D1 Sprint 3 - exempt models (Tenant) still own array columns.
            // Serialize before Prisma's client-side type check sees the args
            // against the SQLite-shaped client (where the columns are TEXT).
            // No-op on Postgres.
            let outgoing = args;
            if (sqliteMode && model) {
              const a = (args ?? {}) as Record<string, unknown>;
              if (DATA_WRITE_OPS.has(operation) && a.data !== undefined) {
                a.data = serializeArrayFields(model, a.data);
              }
              if (operation === 'upsert') {
                if (a.create !== undefined) a.create = serializeArrayFields(model, a.create);
                if (a.update !== undefined) a.update = serializeArrayFields(model, a.update);
              }
              outgoing = a;
            }
            const result = await query(outgoing);
            return sqliteMode && model ? deserializeArrayFields(model, result) : result;
          }
          const ctx = tenantContext.current();
          if (!ctx) {
            throw new Error(
              `Prisma ${model}.${operation} called without a tenant context. ` +
              'Wrap your request in tenantContext.run({ tenantId }, ...).',
            );
          }
          if (ctx.bypass) {
            // Same Sprint 3 gate as the exempt branch - bypass can target any
            // model, including TradingPartner (the three array columns) and
            // Tenant (ourIsaIds).
            let outgoing = args;
            if (sqliteMode) {
              const a = (args ?? {}) as Record<string, unknown>;
              if (DATA_WRITE_OPS.has(operation) && a.data !== undefined) {
                a.data = serializeArrayFields(model, a.data);
              }
              if (operation === 'upsert') {
                if (a.create !== undefined) a.create = serializeArrayFields(model, a.create);
                if (a.update !== undefined) a.update = serializeArrayFields(model, a.update);
              }
              outgoing = a;
            }
            const result = await query(outgoing);
            return sqliteMode ? deserializeArrayFields(model, result) : result;
          }
          if (!MULTI_TENANT_MODELS.has(model)) {
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
            if (a.data !== undefined) {
              a.data = injectInData(a.data, model, ctx.tenantId, dmmf);
            }
            if (operation === 'upsert') {
              a.where = injectInWhere(a.where, ctx.tenantId);
              if (a.create !== undefined) {
                a.create = injectInData(a.create, model, ctx.tenantId, dmmf);
              }
            }
          }

          // D1 Sprint 3 - array serialization on SQLite, after tenant
          // injection so tenantId is in place, and before the query so
          // Prisma sees JSON strings rather than arrays.
          if (sqliteMode) {
            if (DATA_WRITE_OPS.has(operation) && a.data !== undefined) {
              a.data = serializeArrayFields(model, a.data);
            }
            if (operation === 'upsert') {
              if (a.create !== undefined) a.create = serializeArrayFields(model, a.create);
              if (a.update !== undefined) a.update = serializeArrayFields(model, a.update);
            }
          }

          const result = await query(a);
          return sqliteMode ? deserializeArrayFields(model, result) : result;
        },
      },
    },
  });
  return extended as unknown as T;
}
