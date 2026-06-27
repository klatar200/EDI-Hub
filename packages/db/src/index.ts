/**
 * Database access for the EDI Data Hub.
 *
 * Exports a singleton PrismaClient plus the generated types. Consumers should
 * import from `@edi/db` rather than reaching for `@prisma/client` directly,
 * so connection handling stays centralised.
 *
 * Phase 9 Sprint 1 — the returned client is wrapped in the tenant extension,
 * so every query reads tenant context from AsyncLocalStorage.
 *
 * Desktop track D1 Sprint 2 — `getPrisma` / `disconnectPrisma` moved into
 * `client-factory.ts` so the provider (Postgres vs SQLite) can be selected
 * from `DATABASE_PROVIDER`. Re-exported here so existing imports keep
 * working unchanged.
 *
 * Desktop track D1 Sprint 3 — array-serialization helpers are re-exported so
 * tests and downstream packages can call them directly.
 */
export * from '@prisma/client';
export {
  tenantContext,
  PILOT_TENANT_ID,
  TenantContextMissingError,
  type TenantContextValue,
} from './tenant-context.js';
export {
  withTenantExtension,
  MULTI_TENANT_MODELS,
  TENANT_EXEMPT_MODELS,
  injectInData,
  injectInWhere,
  type MinimalDmmf,
} from './tenant-extension.js';
export {
  getPrisma,
  disconnectPrisma,
} from './client-factory.js';
export {
  resolveProvider,
  type DatabaseProvider,
} from './provider.js';
export {
  ARRAY_FIELDS_BY_MODEL,
  serializeArrayFields,
  deserializeArrayFields,
} from './array-serialization.js';
