/**
 * GET /metrics/rejection-rate — per-partner rolling-window rejection rate.
 *
 *   GET /metrics/rejection-rate
 *   GET /metrics/rejection-rate?from=2026-05-01&to=2026-06-01
 *   GET /metrics/rejection-rate?partner=ACME
 *
 * Defaults: rolling 30-day window ending at `now`.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ApiErrorResponse, RejectionRateResponse } from '@edi/shared';
import { getRejectionRate } from '../services/metrics.js';

import { requiresRole } from '../plugins/rbac.js';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function metricsRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get<{ Querystring: { from?: string; to?: string; partner?: string } }>(
    '/metrics/rejection-rate',
    requiresRole('viewer'),
    async (request, reply) => {
      const now = new Date();
      const toRaw = request.query.to;
      const fromRaw = request.query.from;
      const to = toRaw ? parseDate(toRaw) : now;
      const from = fromRaw ? parseDate(fromRaw) : new Date(now.getTime() - THIRTY_DAYS_MS);

      if (!from || !to) {
        const body: ApiErrorResponse = {
          error: {
            code: 'INVALID_QUERY',
            message: 'from/to must be ISO-8601 dates if provided.',
          },
        };
        return reply.code(400).send(body);
      }
      if (from.getTime() > to.getTime()) {
        const body: ApiErrorResponse = {
          error: { code: 'INVALID_QUERY', message: 'from must be <= to.' },
        };
        return reply.code(400).send(body);
      }

      const rows = await getRejectionRate(app.prisma, {
        from,
        to,
        partner: request.query.partner,
        ourIsaIds: app.config.ourIsaIds,
      });

      const body: RejectionRateResponse = {
        windowFrom: from.toISOString(),
        windowTo: to.toISOString(),
        rows,
      };
      return reply.code(200).send(body);
    },
  );
}
