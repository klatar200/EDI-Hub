/**
 * Phase 6 — Trading Partner Config CRUD.
 *
 *   GET    /partners-config            list
 *   GET    /partners-config/:id        single
 *   POST   /partners-config            create
 *   PATCH  /partners-config/:id        update
 *   DELETE /partners-config/:id        remove
 *
 * Validation:
 *   - 400 INVALID_BODY for malformed input
 *   - 404 NOT_FOUND on a missing id
 *   - 409 ISA_OVERLAP when another partner already claims one of these ISA IDs
 */
import type { FastifyInstance, FastifyPluginOptions, FastifyReply } from 'fastify';
import type {
  ApiErrorResponse,
  PartnerConfigInput,
  PartnerConfigListResponse,
  SegmentLabelOverrides,
  TradingPartnerRecord,
} from '@edi/shared';
import { tenantContext } from '@edi/db';
import { requiresRole } from '../plugins/rbac.js';
import { withAudit, emitAudit } from '../services/audit.js';
import {
  assertNoIsaOverlap,
  getPartner,
  listPartners,
  PartnerConflictError,
  PartnerValidationError,
  toRecord,
  validatePartnerInput,
} from '../services/partners.js';

function badBody(reply: FastifyReply, err: Error): FastifyReply {
  const body: ApiErrorResponse = {
    error: {
      code: 'INVALID_BODY',
      message: err instanceof PartnerValidationError && err.field
        ? `${err.field}: ${err.message}`
        : err.message,
    },
  };
  return reply.code(400).send(body);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readInput(body: unknown): PartnerConfigInput {
  if (!isObject(body)) {
    throw new PartnerValidationError('Request body must be an object.');
  }
  const input: PartnerConfigInput = {
    displayName: String(body.displayName ?? '').trim(),
    isaSenderIds: Array.isArray(body.isaSenderIds) ? body.isaSenderIds.map(String) : [],
    isaReceiverIds: Array.isArray(body.isaReceiverIds) ? body.isaReceiverIds.map(String) : [],
    status: body.status === 'disabled' ? 'disabled' : body.status === 'active' ? 'active' : undefined,
    notes: typeof body.notes === 'string' ? body.notes : body.notes === null ? null : undefined,
    contacts: Array.isArray(body.contacts)
      ? body.contacts
          .filter(isObject)
          .map((c) => ({
            name: String(c.name ?? ''),
            email: String(c.email ?? ''),
            role: String(c.role ?? ''),
            slackWebhook:
              typeof c.slackWebhook === 'string' && c.slackWebhook.length > 0
                ? c.slackWebhook
                : undefined,
            alertTypeOptIns: Array.isArray(c.alertTypeOptIns)
              ? (c.alertTypeOptIns as unknown[]).filter(
                  (t): t is 'MISSING_ACK' | 'REJECTION_RATE_SPIKE' | 'STALE_TRAFFIC' =>
                    t === 'MISSING_ACK' || t === 'REJECTION_RATE_SPIKE' || t === 'STALE_TRAFFIC',
                )
              : undefined,
          }))
          .filter((c) => c.email.length > 0)
      : undefined,
    supportedSets: Array.isArray(body.supportedSets)
      ? body.supportedSets.map(String).filter((s) => s.length > 0)
      : undefined,
    lifecycleFlows: Array.isArray(body.lifecycleFlows)
      ? (body.lifecycleFlows as unknown[]).filter(isObject).map((f) => ({
          name: String(f.name ?? ''),
          entrySetId: String(f.entrySetId ?? ''),
          steps: Array.isArray(f.steps)
            ? (f.steps as unknown[]).filter(isObject).map((st) => ({
                setId: String(st.setId ?? ''),
                direction:
                  st.direction === 'inbound' || st.direction === 'outbound' || st.direction === 'unknown'
                    ? st.direction
                    : 'unknown',
              }))
            : [],
        }))
      : undefined,
    ackCodeOverrides: isObject(body.ackCodeOverrides)
      ? (body.ackCodeOverrides as Record<string, unknown>)
      : undefined,
    segmentLabelOverrides: isObject(body.segmentLabelOverrides)
      ? (body.segmentLabelOverrides as SegmentLabelOverrides)
      : undefined,
    slaWindows: Array.isArray(body.slaWindows)
      ? (body.slaWindows as unknown[]).filter(isObject).map((w) => ({
          setId: String(w.setId ?? ''),
          direction:
            w.direction === 'inbound' || w.direction === 'outbound' || w.direction === 'unknown'
              ? w.direction
              : 'unknown',
          withinMinutes: Number(w.withinMinutes ?? 0),
          expectedAckSetId: typeof w.expectedAckSetId === 'string' ? w.expectedAckSetId : undefined,
        }))
      : undefined,
    slaCountdownEnabled: typeof body.slaCountdownEnabled === 'boolean' ? body.slaCountdownEnabled : undefined,
    // Phase 8 Sprint 3 — connectivity:
    //   - omitted → undefined → PATCH leaves the current value alone
    //   - explicit null → cleared
    //   - object → shape-checked here, semantically validated in validatePartnerInput
    connectivity: body.connectivity === null
      ? null
      : isObject(body.connectivity)
        ? {
            // Channel is preserved verbatim and validated against the enum
            // in validatePartnerInput — we don't silently coerce a bad value.
            channel: body.connectivity.channel as never,
            endpoint: typeof body.connectivity.endpoint === 'string'
              ? body.connectivity.endpoint.trim()
              : '',
            technicalContact: typeof body.connectivity.technicalContact === 'string'
              ? body.connectivity.technicalContact.trim()
              : '',
            notes: typeof body.connectivity.notes === 'string' && body.connectivity.notes.length > 0
              ? body.connectivity.notes
              : undefined,
          }
        : undefined,
  };
  validatePartnerInput(input);
  return input;
}

export async function partnersConfigRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get('/partners-config', requiresRole('viewer'), async (_request, reply) => {
    const items = await listPartners(app.prisma);
    const body: PartnerConfigListResponse = { items };
    return reply.code(200).send(body);
  });

  app.get<{ Params: { id: string } }>('/partners-config/:id', requiresRole('viewer'), async (request, reply) => {
    const record = await getPartner(app.prisma, request.params.id);
    if (!record) {
      const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'No partner with that id.' } };
      return reply.code(404).send(body);
    }
    return reply.code(200).send(record);
  });

  app.post('/partners-config', requiresRole('admin'), async (request, reply) => {
    let input: PartnerConfigInput;
    try {
      input = readInput(request.body);
    } catch (err) {
      return badBody(reply, err as Error);
    }
    try {
      await assertNoIsaOverlap(app.prisma, input);
    } catch (err) {
      if (err instanceof PartnerConflictError) {
        const body: ApiErrorResponse = {
          error: { code: 'ISA_OVERLAP', message: err.message },
        };
        return reply.code(409).send({ ...body, overlaps: err.overlaps });
      }
      throw err;
    }

    // Phase 9 Sprint 4 — wrap create + audit emit in a single $transaction.
    // If the audit insert fails, the partner create rolls back too.
    const created = await withAudit(
      app.prisma,
      {
        action: 'partner.create',
        targetType: 'tradingPartner',
        actorId: request.auth?.userId ?? null,
      },
      (tx) => tx.tradingPartner.create({
        data: {
          // Phase 9 Sprint 1 — tenantId is required by the schema. The active
          // request's tenant context is the source of truth.
          tenantId: tenantContext.requireTenantId(),
          displayName: input.displayName,
          isaSenderIds: input.isaSenderIds,
          isaReceiverIds: input.isaReceiverIds,
          status: input.status ?? 'active',
          notes: input.notes ?? null,
          contacts: (input.contacts ?? []) as never,
          supportedSets: input.supportedSets ?? [],
          lifecycleFlows: (input.lifecycleFlows ?? []) as never,
          ackCodeOverrides: (input.ackCodeOverrides ?? {}) as never,
          segmentLabelOverrides: (input.segmentLabelOverrides ?? {}) as never,
          slaWindows: (input.slaWindows ?? []) as never,
          slaCountdownEnabled: input.slaCountdownEnabled ?? false,
          // Phase 8 Sprint 3 — empty `{}` default for an unconfigured partner,
          // matching the schema default and the readConnectivity sentinel.
          connectivity: (input.connectivity ?? {}) as never,
        },
      }),
      (row) => ({ targetId: row.id, after: row }),
    );
    const record: TradingPartnerRecord = toRecord(created as never);
    return reply.code(201).send(record);
  });

  app.patch<{ Params: { id: string } }>('/partners-config/:id', requiresRole('admin'), async (request, reply) => {
    const existing = await app.prisma.tradingPartner.findUnique({
      where: { id: request.params.id },
    });
    if (!existing) {
      const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'No partner with that id.' } };
      return reply.code(404).send(body);
    }
    let input: PartnerConfigInput;
    try {
      input = readInput(request.body);
    } catch (err) {
      return badBody(reply, err as Error);
    }
    try {
      await assertNoIsaOverlap(app.prisma, input, request.params.id);
    } catch (err) {
      if (err instanceof PartnerConflictError) {
        const body: ApiErrorResponse = {
          error: { code: 'ISA_OVERLAP', message: err.message },
        };
        return reply.code(409).send({ ...body, overlaps: err.overlaps });
      }
      throw err;
    }

    // Phase 9 Sprint 4 — update + audit emit in a single transaction. The
    // `before` snapshot is `existing` (read above) so the audit row captures
    // both pre- and post-state for the admin investigating later.
    const updated = await withAudit(
      app.prisma,
      {
        action: 'partner.update',
        targetType: 'tradingPartner',
        actorId: request.auth?.userId ?? null,
      },
      (tx) => tx.tradingPartner.update({
        where: { id: request.params.id },
        data: {
          displayName: input.displayName,
          isaSenderIds: input.isaSenderIds,
          isaReceiverIds: input.isaReceiverIds,
          status: input.status ?? 'active',
          notes: input.notes === undefined ? undefined : input.notes,
          contacts: (input.contacts ?? []) as never,
          supportedSets: input.supportedSets ?? [],
          lifecycleFlows: (input.lifecycleFlows ?? []) as never,
          ackCodeOverrides: (input.ackCodeOverrides ?? {}) as never,
          segmentLabelOverrides: (input.segmentLabelOverrides ?? {}) as never,
          slaWindows: (input.slaWindows ?? []) as never,
          slaCountdownEnabled:
            input.slaCountdownEnabled === undefined ? undefined : input.slaCountdownEnabled,
          connectivity:
            input.connectivity === undefined
              ? undefined
              : ((input.connectivity ?? {}) as never),
        },
      }),
      (row) => ({ targetId: row.id, before: existing, after: row }),
    );
    const record: TradingPartnerRecord = toRecord(updated as never);
    return reply.code(200).send(record);
  });

  app.delete<{ Params: { id: string } }>('/partners-config/:id', requiresRole('admin'), async (request, reply) => {
    const existing = await app.prisma.tradingPartner.findUnique({
      where: { id: request.params.id },
    });
    if (!existing) {
      const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'No partner with that id.' } };
      return reply.code(404).send(body);
    }
    // Phase 9 Sprint 4 — delete + audit emit atomically. The audit row
    // captures the deleted snapshot as `before`; after is omitted because
    // the row no longer exists.
    await app.prisma.$transaction(async (tx) => {
      await tx.tradingPartner.delete({ where: { id: request.params.id } });
      await emitAudit(tx, {
        action: 'partner.delete',
        targetType: 'tradingPartner',
        targetId: request.params.id,
        actorId: request.auth?.userId ?? null,
        payloadDiff: { before: existing },
      });
    });
    return reply.code(204).send();
  });
}
