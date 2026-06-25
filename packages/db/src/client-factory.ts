/**
 * Desktop track D1 Sprint 2 — provider-switching Prisma client factory.
 *
 * The SaaS / web build keeps using the PostgreSQL-generated client at
 * `@prisma/client` (the default). The local desktop-dev workflow can flip
 * `DATABASE_PROVIDER=sqlite` to load the SQLite-generated client from
 * `node_modules/.prisma/client-sqlite` (output configured in
 * `prisma/schema.sqlite.prisma`). The desktop INSTALLER uses embedded
 * Postgres, not SQLite — see DESKTOP_SPRINT_PLAN.md §35.
 *
 * Both clients are wrapped in the tenant extension before being returned, so
 * downstream callers see the same Prisma surface regardless of provider.
 *
 * Notes:
 *   - Resolution is via `createRequire` so `getPrisma()` stays synchronous,
 *     matching the pre-D1 signature.
 *   - The SQLite client is loaded lazily so a Postgres-only build (CI, the
 *     SaaS web image) does not need `db:generate:sqlite` to have been run.
 *   - In SQLite mode, four array columns are stored as JSON-serialised TEXT.
 *     D1 Sprint 3 installs read/write middleware in `tenant-extension.ts`
 *     that hides the format diff from the API code.
 *   - `resolveProvider` lives in `provider.ts` so this file and
 *     `tenant-extension.ts` can both depend on it without a cycle.
 */
import { createRequire } from 'node:module';
// Node's ESM loader cannot extract named exports from CJS modules with
// `verbatimModuleSyntax: true`. `@prisma/client` is CJS — import the
// default (module.exports) and destructure the constructor from it.
// Type-only import keeps the typed `PrismaClient` interface available
// for signatures without affecting the runtime import.
import prismaPkg from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { withTenantExtension } from './tenant-extension.js';
import { resolveProvider, type DatabaseProvider } from './provider.js';

const { PrismaClient: PrismaClientCtor } = prismaPkg;

export { resolveProvider, type DatabaseProvider };

/** Internal: load the right PrismaClient constructor for the resolved provider. */
function loadPrismaClientCtor(provider: DatabaseProvider): new () => PrismaClient {
  if (provider === 'sqlite') {
    const req = createRequire(import.meta.url);
    type GeneratedSqliteClient = { PrismaClient: new () => PrismaClient };
    const mod = req('.prisma/client-sqlite') as GeneratedSqliteClient;
    return mod.PrismaClient;
  }
  return PrismaClientCtor;
}

let cached: PrismaClient | undefined;

/**
 * Returns a process-wide PrismaClient, created lazily on first use. The
 * returned client is already wrapped in the tenant extension.
 */
export function getPrisma(): PrismaClient {
  if (cached) return cached;
  const provider = resolveProvider();
  const Ctor = loadPrismaClientCtor(provider);
  cached = withTenantExtension(new Ctor());
  return cached;
}

/** Closes the shared client. Call on graceful shutdown / after tests. */
export async function disconnectPrisma(): Promise<void> {
  if (cached) {
    await cached.$disconnect();
    cached = undefined;
  }
}

/** Test-only: reset the cached client so a subsequent `getPrisma()` re-reads
 *  `DATABASE_PROVIDER`. */
export function __resetForTests(): void {
  cached = undefined;
}
