/**
 * Phase 7 Sprint 1 — alerts API.
 *
 *   GET    /alerts                   list (filterable)
 *   GET    /alerts/:id               single
 *   PATCH  /alerts/:id/ack           acknowledge (body: { who })
 *
 * Detection lives in `services/detection.ts` and writes alerts; this route is
 * a read + acknowledge surface only.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type {
  AlertAckInput,
  AlertBulkAckInput,
  AlertBulkAckResponse,
  AlertListResponse,
  AlertRecord,
  ApiErrorResponse,
  AlertStatus,
  AlertType,
} from '@edi/shared';
import { getAlert, listAlerts, bulkAcknowledgeAlerts, toRecord as alertToRecord } from '../services/alerts.js';
import { emitAudit } from '../services/audit.js';

import { requiresRole } from '../plugins/rbac.js';
const STATUS_SET = new Set<AlertStatus>(['active', 'acknowledged', 'resolved']);
const TYPE_SET = new Set<AlertType>(['MISSING_ACK', 'REJECTION_RATE_SPIKE', 'STALE_TRAFFIC', 'UNKNOWN_ISA']);

export async function alertsRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get<{ Querystring: { status?: string; type?: string; partnerId?: string; partnerName?: string; from?: string; to?: string } }>(
    '/alerts',
    requiresRole('viewer'),
    async (request, reply) => {
      const q = request.query;
      const items = await listAlerts(app.prisma, {
        status: q.status && STATUS_SET.has(q.status as AlertStatus) ? (q.status as AlertStatus) : undefined,
        type: q.type && TYPE_SET.has(q.type as AlertType) ? (q.type as AlertType) : undefined,
        partnerId: q.partnerId,
        partnerName: q.partnerName,
        from: q.from,
        to: q.to,
      });
      const body: AlertListResponse = { items };
      return reply.code(200).send(body);
    },
  );

  app.get<{ Params: { id: string } }>('/alerts/:id', requiresRole('viewer'), async (request, reply) => {
    const record = await getAlert(app.prisma, request.params.id);
    if (!record) {
      const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'No alert with that id.' } };
      return reply.code(404).send(body);
    }
    return reply.code(200).send(record);
  });

  // Phase 9 Sprint 4 — ack inline so the audit insert lives in the same
  // $transaction as the alert update. (The previous version delegated to the
  // alerts service; we keep the same fields but inline because the service's
  // PrismaClient parameter doesn't accept a TransactionClient.)
  app.patch<{ Params: { id: string }; Body: Partial<AlertAckInput> & { suppressMinutes?: number } }>(
    '/alerts/:id/ack',
    requiresRole('ops'),
    async (request, reply) => {
      const who = (request.body?.who ?? '').trim();
      if (!who) {
        const body: ApiErrorResponse = {
          error: { code: 'INVALID_BODY', message: '`who` is required (the actor acknowledging the alert).' },
        };
        return reply.code(400).send(body);
      }
      const overrideMinutes = Number(request.body?.suppressMinutes);
      const suppressMinutes =
        Number.isFinite(overrideMinutes) && overrideMinutes > 0
          ? Math.floor(overrideMinutes)
          : app.config.alertSuppressionMinutes;
      const now = new Date();
      const suppressUntil = new Date(now.getTime() + Math.max(1, suppressMinutes) * 60 * 1000);

      const result = await app.prisma.$transaction(async (tx) => {
        const existing = await tx.alert.findUnique({ where: { id: request.params.id } });
        if (!existing) return null;
        const updated = await tx.alert.update({
          where: { id: request.params.id },
          data: {
            status: 'acknowledged',
            acknowledgedAt: now,
            acknowledgedBy: who,
            suppressUntil,
          },
        });
        await emitAudit(tx, {
          action: 'alert.ack',
          targetType: 'alert',
          targetId: request.params.id,
          actorId: request.auth?.userId ?? null,
          payloadDiff: { before: existing, after: updated },
        });
        return updated;
      });
      if (!result) {
        const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'No alert with that id.' } };
        return reply.code(404).send(body);
      }
      const body: AlertRecord = alertToRecord(result as never);
      return reply.code(200).send(body);
    },
  );

  app.post<{ Params: { id: string }; Body: { minutes?: number } }>(
    '/alerts/:id/snooze',
    requiresRole('ops'),
    async (request, reply) => {
      const minutes = Number(request.body?.minutes);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        const body: ApiErrorResponse = {
          error: { code: 'INVALID_BODY', message: '`minutes` must be a positive number.' },
        };
        return reply.code(400).send(body);
      }
      const now = new Date();
      const until = new Date(now.getTime() + Math.max(1, Math.floor(minutes)) * 60 * 1000);
      const result = await app.prisma.$transaction(async (tx) => {
        const existing = await tx.alert.findUnique({ where: { id: request.params.id } });
        if (!existing) return null;
        const updated = await tx.alert.update({
          where: { id: request.params.id },
          data: { suppressUntil: until, lastSeenAt: now },
        });
        await emitAudit(tx, {
          action: 'alert.snooze',
          targetType: 'alert',
          targetId: request.params.id,
          actorId: request.auth?.userId ?? null,
          payloadDiff: { before: existing, after: updated },
        });
        return updated;
      });
      if (!result) {
        const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'No alert with that id.' } };
        return reply.code(404).send(body);
      }
      const body: AlertRecord = alertToRecord(result as never);
      return reply.code(200).send(body);
    },
  );

  app.post<{ Body: AlertBulkAckInput }>(
    '/alerts/bulk-ack',
    requiresRole('ops'),
    async (request, reply) => {
      const who = (request.body?.who ?? '').trim();
      if (!who) {
        const body: ApiErrorResponse = {
          error: { code: 'INVALID_BODY', message: '`who` is required.' },
        };
        return reply.code(400).send(body);
      }
      const count = await bulkAcknowledgeAlerts(
        app.prisma,
        {
          who,
          partnerId: request.body.partnerId,
          partnerName: request.body.partnerName,
        },
        app.config.alertSuppressionMinutes,
      );
      const body: AlertBulkAckResponse = { acknowledged: count };
      return reply.code(200).send(body);
    },
  );
}
