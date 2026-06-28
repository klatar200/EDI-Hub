/**
 * Phase 9 Sprint 3 — Users CRUD (admin-only) + a /me endpoint.
 *
 *   GET    /me                 the calling user's row + role. viewer.
 *   GET    /users              list users in the active tenant. viewer (so
 *                              the org switcher / UI shows team membership).
 *   PATCH  /users/:id          change role or displayName. admin.
 *   DELETE /users/:id          remove from tenant. admin.
 *
 * Identity is owned by Clerk — User rows are created by the
 * organizationMembership.created webhook (Sprint 2). This route mutates
 * role + displayName on existing rows; we never create them here. Deleting
 * a User row revokes hub access; the Clerk org membership is unaffected
 * (admins remove that separately in the Clerk dashboard).
 *
 * Safety:
 *   - An admin cannot demote themselves below admin (would lock the tenant
 *     out of further user management; if the last admin steps down, they
 *     should promote a successor first).
 *   - Admin can't delete their own row for the same reason.
 *   - Cross-tenant access is blocked by the Prisma extension's tenant filter;
 *     a viewer in tenant A asking for a user id from tenant B gets 404 (the
 *     filtered query returns null and we report NOT_FOUND uniformly to
 *     avoid leaking the existence of cross-tenant rows).
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ApiErrorResponse } from '@edi/shared';

import { requiresRole } from '../plugins/rbac.js';
import { emitAudit, type AuditAction } from '../services/audit.js';
import { LAN_TOKEN_USER_ID } from '../services/lan-auth.js';
interface UserRecord {
  id: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'ops' | 'viewer';
  clerkUserId: string;
  createdAt: string;
  updatedAt: string;
}

interface DbUser {
  id: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'ops' | 'viewer';
  clerkUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(u: DbUser): UserRecord {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    clerkUserId: u.clerkUserId,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

const ROLES = new Set(['admin', 'ops', 'viewer']);

export async function userRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  // GET /me — every signed-in user can read their own row + role. The web
  // app uses this to drive the useRole() hook + RequireRole wrapper.
  app.get('/me', requiresRole('viewer'), async (request, reply) => {
    if (!request.auth) {
      // Dev-fallback (no Clerk) — return a synthetic admin so the web's
      // RequireRole wrappers don't hide everything from the local developer.
      return reply.code(200).send({
        id: 'dev-fallback',
        email: 'dev@local',
        displayName: 'Dev (fallback)',
        role: 'admin' as const,
        clerkUserId: 'dev-fallback',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      });
    }
    if (request.auth.userId === LAN_TOKEN_USER_ID) {
      return reply.code(200).send({
        id: request.auth.userId,
        email: 'lan@desktop',
        displayName: 'LAN operator',
        role: 'admin' as const,
        clerkUserId: 'lan-token',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      });
    }
    const row = (await app.prisma.user.findUnique({
      where: { id: request.auth.userId },
    })) as unknown as DbUser | null;
    if (!row) {
      const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'User row missing.' } };
      return reply.code(404).send(body);
    }
    return reply.code(200).send(toRecord(row));
  });

  // GET /users — list every user in the active tenant. viewer so the UI can
  // show "team" lists without elevating access.
  app.get('/users', requiresRole('viewer'), async (_request, reply) => {
    const rows = (await app.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
    })) as unknown as DbUser[];
    return reply.code(200).send({ items: rows.map(toRecord) });
  });

  // PATCH /users/:id — admin-only. Mutates role and/or displayName.
  app.patch<{ Params: { id: string }; Body: { role?: string; displayName?: string | null } }>(
    '/users/:id',
    requiresRole('admin'),
    async (request, reply) => {
      const { role, displayName } = request.body ?? {};
      if (role !== undefined && !ROLES.has(role)) {
        const body: ApiErrorResponse = {
          error: { code: 'INVALID_ROLE', message: `role must be one of admin / ops / viewer.` },
        };
        return reply.code(400).send(body);
      }

      // Self-demotion guard: an admin demoting themselves below admin would
      // potentially orphan the tenant. Refuse — they should promote someone
      // else first.
      if (request.auth && request.auth.userId === request.params.id && role && role !== 'admin') {
        const body: ApiErrorResponse = {
          error: {
            code: 'CANNOT_DEMOTE_SELF',
            message: 'You cannot demote yourself below admin. Promote another user first.',
          },
        };
        return reply.code(409).send(body);
      }

      // Cross-tenant: the Prisma extension filters by tenantId, so updates
      // against a foreign user id return P2025 (record not found). Catch and
      // surface as 404 to avoid leaking existence.
      //
      // Phase 9 Sprint 4 — wrap in $transaction so the audit row commits
      // atomically with the update. `action` distinguishes role-change from
      // profile-update so the audit list filter is meaningful.
      try {
        const action: AuditAction = role !== undefined
          ? 'user.role-change'
          : 'user.profile-update';
        const updated = await app.prisma.$transaction(async (tx) => {
          const before = await tx.user.findUnique({ where: { id: request.params.id } });
          const next = (await tx.user.update({
            where: { id: request.params.id },
            data: {
              ...(role !== undefined ? { role: role as 'admin' | 'ops' | 'viewer' } : {}),
              ...(displayName !== undefined ? { displayName } : {}),
            },
          })) as unknown as DbUser;
          await emitAudit(tx, {
            action,
            targetType: 'user',
            targetId: request.params.id,
            actorId: request.auth?.userId ?? null,
            payloadDiff: { before, after: next },
          });
          return next;
        });
        return reply.code(200).send(toRecord(updated));
      } catch (err) {
        if (err instanceof Error && /Record to update not found/i.test(err.message)) {
          const body: ApiErrorResponse = {
            error: { code: 'NOT_FOUND', message: 'No user with that id.' },
          };
          return reply.code(404).send(body);
        }
        throw err;
      }
    },
  );

  // DELETE /users/:id — admin-only. Self-delete blocked.
  app.delete<{ Params: { id: string } }>(
    '/users/:id',
    requiresRole('admin'),
    async (request, reply) => {
      if (request.auth && request.auth.userId === request.params.id) {
        const body: ApiErrorResponse = {
          error: {
            code: 'CANNOT_DELETE_SELF',
            message: 'You cannot delete your own user row. Promote another admin to do this for you.',
          },
        };
        return reply.code(409).send(body);
      }
      // Phase 9 Sprint 4 — delete + audit emit atomically. `before` snapshot
      // captures the deleted user for forensic context.
      try {
        await app.prisma.$transaction(async (tx) => {
          const before = await tx.user.findUnique({ where: { id: request.params.id } });
          if (!before) {
            // Force the same P2025-like path as the original delete would
            // hit so the outer catch can map to NOT_FOUND.
            throw new Error('Record to delete does not exist.');
          }
          await tx.user.delete({ where: { id: request.params.id } });
          await emitAudit(tx, {
            action: 'user.delete',
            targetType: 'user',
            targetId: request.params.id,
            actorId: request.auth?.userId ?? null,
            payloadDiff: { before },
          });
        });
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof Error && /Record to delete does not exist/i.test(err.message)) {
          const body: ApiErrorResponse = {
            error: { code: 'NOT_FOUND', message: 'No user with that id.' },
          };
          return reply.code(404).send(body);
        }
        throw err;
      }
    },
  );
}
