/**
 * Phase 9 Sprint 3 — RBAC route-options helper.
 *
 * Returns the `{ config: { requiredRole } }` shape Fastify v5 preserves on
 * `routeOptions.config`. The tenant plugin's preHandler reads it at runtime.
 *
 * Why a helper instead of an inline `{ config: { requiredRole: 'admin' } }`?
 * Fastify types `config` as `FastifyContextConfig & ContextConfig` (an empty
 * augmentable interface plus `unknown`). Direct literals trigger
 * TypeScript's excess-property check — even though the intersection accepts
 * anything, fresh literals get the strict check. Function return values
 * aren't fresh, so passing `requiresRole('admin')` skips the check and
 * everything flows through Fastify cleanly.
 *
 * Usage:
 *   app.get('/path', requiresRole('admin'), handler);
 *   app.get<{ Params: {...} }>('/p/:id', requiresRole('viewer'), handler);
 *
 * Matching read in plugins/tenant.ts:
 *   const cfg = request.routeOptions.config as { requiredRole?: Role } | undefined;
 *   const required = cfg?.requiredRole;
 */

export type Role = 'viewer' | 'ops' | 'admin';

/** Return type intentionally widened to `Record<string, unknown>` so callers
 *  satisfy Fastify's `config: FastifyContextConfig & ContextConfig` (= unknown)
 *  with no excess-property check at the route declaration. The runtime
 *  payload carries `{ requiredRole }` verbatim. */
export function requiresRole(role: Role): { config: Record<string, unknown> } {
  return { config: { requiredRole: role } };
}
