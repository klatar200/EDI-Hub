/**
 * Database access for the EDI Data Hub.
 *
 * Exports a singleton PrismaClient plus the generated types. Consumers should
 * import from `@edi/db` rather than reaching for `@prisma/client` directly,
 * so connection handling stays centralised.
 *
 * Phase 9 Sprint 1 — the returned client is wrapped in the tenant extension,
 * so every query reads tenant context from AsyncLocalStorage. See
 * `tenant-context.ts` and `tenant-extension.ts`.
 */
import { PrismaClient } from '@prisma/client';
import { withTenantExtension } from './tenant-extension.js';

export * from '@prisma/client';
export {
  tenantContext,
  PILOT_TENANT_ID,
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

let prisma: PrismaClient | undefined;

/** Returns a process-wide PrismaClient, created lazily on first use. The
 *  returned client is already wrapped in the tenant extension. */
export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = withTenantExtension(new PrismaClient());
  }
  return prisma;
}

/** Closes the shared client. Call on graceful shutdown / after tests. */
export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}
