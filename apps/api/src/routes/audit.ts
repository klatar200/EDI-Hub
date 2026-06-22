/**
 * Phase 9 Sprint 4 — GET /audit.
 *
 * Admin-only read of the audit log for the active tenant. Filters:
 *   - actorId   exact match on User.id
 *   - action    exact match on the action verb (e.g. 'partner.create')
 *   - from / to ISO datetime bounds on createdAt
 *   - limit / offset pagination (limit capped at 200)
 *
 * The Prisma tenant extension automatically scopes the query by tenantId,
 * so cross-tenant rows are unreachable here even if the caller forges an
 * actorId from another tenant.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ApiErrorResponse } from '@edi/shared';
import { requiresRole } from '../plugins/rbac.js';

interface AuditEventRow {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  payloadDiff: unknown;
  createdAt: Date;
}

interface AuditEventDto {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  payloadDiff: unknown;
  createdAt: string;
}

function toDto(row: AuditEventRow): AuditEventDto {
  return {
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    payloadDiff: row.payloadDiff,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function auditRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get<{
    Querystring: {
      actorId?: string;
      action?: string;
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/audit',
    requiresRole('admin'),
    async (request, reply) => {
      const q = request.query;
      const where: Record<string, unknown> = {};
      if (q.actorId) where.actorId = q.actorId;
      if (q.action) where.action = q.action;
      if (q.from || q.to) {
        const range: { gte?: Date; lte?: Date } = {};
        if (q.from) {
          const d = new Date(q.from);
          if (Number.isNaN(d.getTime())) {
            const body: ApiErrorResponse = {
              error: { code: 'INVALID_QUERY', message: '`from` must be an ISO datetime.' },
            };
            return reply.code(400).send(body);
          }
          range.gte = d;
        }
        if (q.to) {
          const d = new Date(q.to);
          if (Number.isNaN(d.getTime())) {
            const body: ApiErrorResponse = {
              error: { code: 'INVALID_QUERY', message: '`to` must be an ISO datetime.' },
            };
            return reply.code(400).send(body);
          }
          range.lte = d;
        }
        where.createdAt = range;
      }

      const limit = Math.min(Math.max(Number.parseInt(q.limit ?? '50', 10) || 50, 1), 200);
      const offset = Math.max(Number.parseInt(q.offset ?? '0', 10) || 0, 0);

      const rows = (await app.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      })) as unknown as AuditEventRow[];

      return reply.code(200).send({
        items: rows.map(toDto),
        limit,
        offset,
        count: rows.length,
      });
    },
  );
}
