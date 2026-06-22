import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config.js';
import type { ChannelRegistry } from '../channels/registry.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    s3: S3Client;
    prisma: PrismaClient;
    /** Phase 8 Sprint 2 — present only when channels were booted (i.e. in
     *  production index.ts). Tests that bypass `index.ts` will leave this
     *  undefined; the health route handles the missing case. */
    channels?: ChannelRegistry;
  }
  interface FastifyRequest {
    /** Phase 9 Sprint 1.4 — set by the tenant plugin on every non-public
     *  request. Sprint 2 sources this from a verified Clerk JWT. */
    tenantId?: string;
    /** Phase 9 Sprint 2 — verified auth context. Set by the tenant plugin
     *  on every authenticated request (everything except /health and
     *  /webhooks/clerk). `null` in dev-fallback mode when CLERK_SECRET_KEY
     *  is blank — the plugin still pins tenantId to the pilot tenant in that
     *  case, so routes that don't need user/role can ignore this. Routes
     *  that need role-based access read `request.auth?.role`. */
    auth?: {
      userId: string;       // our User.id (uuid)
      clerkUserId: string;  // user_*
      role: 'admin' | 'ops' | 'viewer';
      tenantId: string;
    } | null;
  }
  /** Phase 9 Sprint 3 — per-route RBAC metadata.
   *
   * Fastify v5 only preserves per-route metadata that's declared on
   * `FastifyContextConfig` — top-level unknown options on RouteOptions are
   * dropped at runtime. Augmenting THIS interface makes
   * `{ config: { requiredRole: 'X' } }` both typecheck and survive to
   * `request.routeOptions.config.requiredRole` in the preHandler. */
  interface FastifyContextConfig {
    requiredRole?: 'viewer' | 'ops' | 'admin';
  }
}
