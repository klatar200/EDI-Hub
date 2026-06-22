/**
 * Phase 9 Sprint 2 — Clerk webhooks.
 *
 *   POST /webhooks/clerk    Svix-signed payload from Clerk.
 *
 * Handles the organization + membership lifecycle events that keep our
 * `Tenant` and `User` rows in sync with Clerk:
 *
 *   organization.created            → create Tenant (idempotent on clerkOrgId)
 *   organization.updated            → mirror display name changes
 *   organizationMembership.created  → create User (idempotent on tenantId+clerkUserId)
 *   organizationMembership.updated  → mirror role changes
 *   organizationMembership.deleted  → delete User row
 *
 * Signature verification is REQUIRED — the route refuses to process when
 * `CLERK_WEBHOOK_SECRET` is unset (dev-fallback returns 503, prod fails boot
 * if the secret was supposed to be there). Without verification, anyone with
 * the URL could mint Tenants / Users for free.
 *
 * Idempotency: every event handler uses `upsert` or a guarded `create` so a
 * Clerk retry (which happens often — they retry until 2xx) is safe.
 *
 * Important: this route is in `PUBLIC_ROUTES` in plugins/tenant.ts. It must
 * set its own tenant context via `tenantContext.bypass(...)` because admin
 * writes here span the Tenant table itself.
 */
import { Webhook } from 'svix';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { tenantContext } from '@edi/db';

/** Minimum shape we pull off the Clerk event payload. Clerk's schema is
 *  much richer; we only consume the fields we map into our DB. */
interface ClerkOrganization {
  id: string;
  name: string;
}
interface ClerkOrganizationMembership {
  organization: { id: string };
  public_user_data: {
    user_id: string;
    identifier?: string;
    first_name?: string | null;
    last_name?: string | null;
  };
  /** Clerk role string: `org:admin`, `org:member`, etc. We map this to our
   *  UserRole enum (admin/ops/viewer). */
  role: string;
}

type ClerkEvent =
  | { type: 'organization.created' | 'organization.updated'; data: ClerkOrganization }
  | {
      type:
        | 'organizationMembership.created'
        | 'organizationMembership.updated'
        | 'organizationMembership.deleted';
      data: ClerkOrganizationMembership;
    }
  | { type: string; data: unknown };

/** Map Clerk's role string to our UserRole enum. `org:admin` → admin; anything
 *  else maps to `viewer` for safety (admins promote to `ops` via the Users
 *  page; we never auto-promote from a Clerk role we don't recognize). */
function mapClerkRole(role: string): 'admin' | 'ops' | 'viewer' {
  if (role === 'org:admin' || role === 'admin') return 'admin';
  return 'viewer';
}

function displayNameFor(m: ClerkOrganizationMembership['public_user_data']): string | null {
  const first = m.first_name?.trim();
  const last = m.last_name?.trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  return null;
}

export async function webhookRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  // Svix verifies the SIGNATURE over the RAW BYTES of the request body. The
  // default Fastify body parser turns JSON into an object before our handler
  // sees it, which loses the byte-exact representation Svix needs. So we
  // register a content-type parser scoped to this plugin's encapsulation
  // that hands us the raw Buffer.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.post('/webhooks/clerk', async (request, reply) => {
    const secret = app.config.clerk.webhookSecret;
    if (!secret) {
      return reply.code(503).send({
        error: {
          code: 'WEBHOOK_NOT_CONFIGURED',
          message: 'CLERK_WEBHOOK_SECRET is not set — webhook endpoint is dormant.',
        },
      });
    }

    // Verify the Svix signature over the raw body. Reject anything we can't
    // verify — silently accepting unsigned events would let anyone with the
    // URL mint Tenants / Users.
    const rawBody = request.body as Buffer | undefined;
    if (!rawBody) {
      return reply.code(400).send({ error: { code: 'NO_BODY', message: 'Empty body.' } });
    }
    const headers = {
      'svix-id': String(request.headers['svix-id'] ?? ''),
      'svix-timestamp': String(request.headers['svix-timestamp'] ?? ''),
      'svix-signature': String(request.headers['svix-signature'] ?? ''),
    };

    let event: ClerkEvent;
    try {
      const wh = new Webhook(secret);
      event = wh.verify(rawBody.toString('utf8'), headers) as ClerkEvent;
    } catch (err) {
      request.log.warn({ err }, 'clerk webhook: signature verification failed');
      return reply.code(401).send({
        error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed.' },
      });
    }

    // All DB writes here cross the Tenant/User boundary (no active tenant yet)
    // so we run them inside an explicit bypass — the Prisma extension would
    // otherwise refuse to operate on the cross-tenant code path.
    await tenantContext.bypass(async () => {
      switch (event.type) {
        case 'organization.created':
        case 'organization.updated': {
          const org = event.data as ClerkOrganization;
          await app.prisma.tenant.upsert({
            where: { clerkOrgId: org.id },
            create: { displayName: org.name, clerkOrgId: org.id },
            update: { displayName: org.name },
          });
          break;
        }
        case 'organizationMembership.created':
        case 'organizationMembership.updated': {
          const m = event.data as ClerkOrganizationMembership;
          const tenant = await app.prisma.tenant.findUnique({
            where: { clerkOrgId: m.organization.id },
          });
          if (!tenant) {
            // Out-of-order delivery — membership arrived before the org
            // event. Log and 200; Clerk won't retry on 2xx, but the missing
            // org will trigger user-not-provisioned 403s until a manual
            // reconcile script runs.
            request.log.warn(
              { orgId: m.organization.id, userId: m.public_user_data.user_id },
              'membership event for unknown org — skipping (manual reconcile required)',
            );
            break;
          }
          const email = m.public_user_data.identifier ?? '';
          const displayName = displayNameFor(m.public_user_data);
          const role = mapClerkRole(m.role);
          await app.prisma.user.upsert({
            where: {
              tenantId_clerkUserId: {
                tenantId: tenant.id,
                clerkUserId: m.public_user_data.user_id,
              },
            },
            create: {
              tenantId: tenant.id,
              clerkUserId: m.public_user_data.user_id,
              email,
              displayName,
              role,
            },
            update: { email, displayName, role },
          });
          break;
        }
        case 'organizationMembership.deleted': {
          const m = event.data as ClerkOrganizationMembership;
          const tenant = await app.prisma.tenant.findUnique({
            where: { clerkOrgId: m.organization.id },
          });
          if (!tenant) break;
          await app.prisma.user
            .delete({
              where: {
                tenantId_clerkUserId: {
                  tenantId: tenant.id,
                  clerkUserId: m.public_user_data.user_id,
                },
              },
            })
            .catch(() => undefined); // Already gone — fine.
          break;
        }
        default:
          // Unknown event types are 2xx'd so Clerk doesn't retry forever.
          // We log them so we can spot ones we should start handling.
          request.log.info({ type: event.type }, 'clerk webhook: ignoring unhandled event type');
      }
    });

    return reply.code(200).send({ ok: true });
  });
}
