/**
 * Desktop track D1 Sprint 2 — database provider resolution.
 *
 * Split out from `client-factory.ts` so other modules (notably
 * `tenant-extension.ts`, which factory.ts itself depends on for the
 * extension wrapper) can read the active provider without creating a
 * circular import. The factory and the extension both call `resolveProvider`;
 * the cycle is broken because this module imports from nothing under
 * `./`.
 */

export type DatabaseProvider = 'postgresql' | 'sqlite';

/**
 * Pure: read `DATABASE_PROVIDER` (default `postgresql`) and normalise it.
 * Exported so unit tests can verify env resolution without instantiating
 * Prisma.
 */
export function resolveProvider(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseProvider {
  const raw = (env.DATABASE_PROVIDER ?? '').toLowerCase().trim();
  if (raw === 'sqlite') return 'sqlite';
  if (raw === '' || raw === 'postgresql' || raw === 'postgres') return 'postgresql';
  throw new Error(
    `Unsupported DATABASE_PROVIDER='${env.DATABASE_PROVIDER ?? ''}'. ` +
      "Allowed: 'postgresql' (default) or 'sqlite'.",
  );
}
