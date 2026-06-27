/**
 * Phase 9 Sprint 2 + 3 — Tenant + auth + RBAC Fastify plugin.
 *
 * Wraps every authenticated request in a verified tenant context. The Prisma
 * extension reads from this context on every query — if it's missing, queries
 * throw. Routes that need RBAC declare `requiredRole`; this plugin enforces it.
 *
 * Flow:
 *   1. Public routes (`/health`, `/webhooks/clerk`) pass through untouched.
 *   2. Verify the `Authorization: Bearer <jwt>` header via Clerk's SDK.
 *      - invalid token  → 401 UNAUTHENTICATED
 *      - no active org  → 403 SELECT_ORGANIZATION
 *      - verified       → look up Tenant + User, set context.
 *   3. Sprint 3 — if the matched route declares `requiredRole`, check
 *      request.auth.role against it. Lower than required → 403 FORBIDDEN.
 *      Dev-fallback (auth=null) bypasses the role check with implicit admin
 *      so local iteration without Clerk keeps working.
 *
 * Encapsulation: wrapped in `fastify-plugin` so the hook applies to sibling-
 * registered routes (every other `app.register(...)` in server.ts).
 */
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { tenantContext, PILOT_TENANT_ID } from '@edi/db';
import { verifyBearerToken, type AuthOutcome } from '../services/auth.js';
import { isDesktopHubMode } from '../services/hub-config.js';

// Phase 10 Sprint 1.3 — `/readiness` + `/internal/metrics` join the
// allowlist. They run before the API has fully booted (readiness probes
// in particular) and Prometheus scrape traffic shouldn't need a JWT.
// `/internal/*` should only be reachable from inside the VPC; that's
// an infra concern (ALB security group), not an app-layer one.
const PUBLIC_ROUTES = new Set([
  '/health',
  '/readiness',
  '/internal/metrics',
  '/webhooks/clerk',
]);

/** Role power ordering — higher index = more permissions. A user can call
 *  any route whose requiredRole is at or below their own. */
const ROLE_RANK: Record<'viewer' | 'ops' | 'admin', number> = {
  viewer: 0,
  ops: 1,
  admin: 2,
};

interface TenantPluginOptions extends FastifyPluginOptions {
  /** Overrideable for tests — defaults to the real Clerk SDK call.
   *  Tests inject a stub that returns canned outcomes for fixture tokens. */
  verify?: (
    request: FastifyRequest,
    secretKey: string,
    publishableKey?: string,
    authorizedPartiesEnv?: string,
  ) => Promise<AuthOutcome>;
}

async function tenantPluginImpl(
  app: FastifyInstance,
  opts: TenantPluginOptions,
): Promise<void> {
  const verify = opts.verify ?? verifyBearerToken;

  app.addHook('onRequest', async (request, reply) => {
    const route = request.routeOptions.url ?? request.url.split('?')[0];
    if (route && PUBLIC_ROUTES.has(route)) {
      return; // health + webhooks handle context themselves.
    }

    const outcome = await verify(
      request,
      app.config.clerk.secretKey,
      app.config.clerk.publishableKey,
      app.config.clerk.authorizedParties,
    );

    if (outcome.kind === 'dev-fallback') {
      if (app.config.nodeEnv === 'production' && !isDesktopHubMode()) {
        return reply.code(500).send({
          error: {
            code: 'AUTH_MISCONFIGURED',
            message: 'Clerk authentication is not configured for production.',
          },
        });
      }
      // Clerk not configured — pin to pilot tenant so the existing dev
      // workflow keeps working. `request.auth = null` signals "no real user"
      // to any route that cares about role-based access; the role check
      // below treats null as implicit admin so dev iteration isn't blocked.
      // The ALS context itself is set by the sync preHandler below; here we
      // only stamp the request object so the preHandler can read it.
      request.tenantId = PILOT_TENANT_ID;
      request.auth = null;
      return;
    }

    if (outcome.kind === 'invalid') {
      return reply.code(401).send({
        error: { code: 'UNAUTHENTICATED', message: outcome.reason },
      });
    }

    if (outcome.kind === 'no-org') {
      return reply.code(403).send({
        error: {
          code: 'SELECT_ORGANIZATION',
          message: 'Signed in but no active organization. Use the organization switcher to pick one.',
        },
      });
    }

    // outcome.kind === 'verified' — look up Tenant + User. The Tenant table
    // is exempt from the extension's filter, but the extension still wants a
    // context to be set, so bypass for the lookups.
    const { clerkUserId, orgId } = outcome.auth;
    const lookup = await tenantContext.bypass(async () => {
      const tenant = await app.prisma.tenant.findUnique({ where: { clerkOrgId: orgId } });
      if (!tenant) return { tenant: null, user: null };
      const user = await app.prisma.user.findUnique({
        where: { tenantId_clerkUserId: { tenantId: tenant.id, clerkUserId } },
      });
      return { tenant, user };
    });

    if (!lookup.tenant) {
      return reply.code(403).send({
        error: {
          code: 'TENANT_NOT_PROVISIONED',
          message: 'Organization exists in Clerk but is not yet provisioned in the hub. Check webhook delivery.',
        },
      });
    }
    if (!lookup.user) {
      return reply.code(403).send({
        error: {
          code: 'USER_NOT_PROVISIONED',
          message: 'Your membership in this organization is not yet provisioned in the hub. Check webhook delivery.',
        },
      });
    }

    request.tenantId = lookup.tenant.id;
    request.auth = {
      userId: lookup.user.id,
      clerkUserId,
      role: lookup.user.role,
      tenantId: lookup.tenant.id,
    };
    // ALS context itself is set by the sync preHandler below.
  });

  // Phase 10 Sprint 4 (revisited) — ALS-aware preHandler.
  //
  // The earlier implementation called `tenantContext.enterWith(...)` inside
  // the async `onRequest` hook. In Fastify v5 the route handler runs inside
  // a different AsyncResource than `onRequest`, so the `enterWith` store
  // didn't propagate — every Prisma query throws "called without a tenant
  // context" even though `request.tenantId` is correctly set.
  //
  // The fix: use the SYNC done-callback form of preHandler and wrap `done`
  // in `tenantContext.run(...)`. Fastify schedules the next hook + route
  // handler inside the done() call, which means the entire downstream
  // continuation runs inside the ALS scope. This is the same pattern
  // `@fastify/request-context` uses internally.
  //
  // RBAC enforcement also moves here so we get a single ALS-bound hook
  // rather than splitting tenant + RBAC across two preHandlers.
  app.addHook('preHandler', (request, reply, done) => {
    // No tenant set → public route or auth already replied. Pass through.
    if (!request.tenantId) {
      done();
      return;
    }

    // RBAC: requiredRole lives under `routeOptions.config`. Reject below-
    // role callers before entering the ALS scope (no DB queries happen on
    // the rejection path, so the ALS context isn't needed).
    const config = (request.routeOptions.config ?? {}) as {
      requiredRole?: 'viewer' | 'ops' | 'admin';
    };
    const required = config.requiredRole;
    if (required && request.auth && ROLE_RANK[request.auth.role] < ROLE_RANK[required]) {
      reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `This action requires the '${required}' role. Your role is '${request.auth.role}'.`,
        },
      });
      done();
      return;
    }

    // Enter the ALS scope and call done() FROM INSIDE the scope, so every
    // subsequent hook + the route handler + every Prisma query runs with
    // the tenant context set.
    tenantContext.run({ tenantId: request.tenantId, bypass: false }, () => {
      done();
    });
  });
}

export const tenantPlugin = fp(tenantPluginImpl, { name: 'tenant-context' });
