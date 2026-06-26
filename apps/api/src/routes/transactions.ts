/**
 * Transaction read API (Phase 2 + Phase 3).
 *
 *   GET /transactions/:id   — typed interpretation + labeled segment/element tree.
 *   GET /transactions       — filterable, paginated list joined with the
 *                             interchange (partner) and raw file (status, date).
 *       filters: set, po, invoice, partner, status, from, to
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ApiErrorResponse, LifecycleDirection, RawFileStatus, TransactionListResponse, TransactionSummary } from '@edi/shared';
import { LIFECYCLE_DIRECTIONS } from '@edi/shared';
import { deriveOutboundStage } from '@edi/shared';
import { interpretTransaction, type DecomposedTransaction } from '@edi/edi-parser';
import { findRejectionFor } from '../services/rejection.js';

import { requiresRole } from '../plugins/rbac.js';
interface ElementRow { index: number; value: string; semanticLabel: string | null }
interface SegmentRow { tag: string; position: number; elements: ElementRow[] }
interface InterchangeRow {
  senderId: string;
  receiverId: string;
  elementSeparator: string;
  subElementSeparator: string;
  segmentTerminator: string;
  rawFile?: { id: string; status: RawFileStatus; ingestedAt: Date; source: string; errorMessage: string | null } | null;
}
interface TransactionRow {
  id: string;
  transactionSetId: string;
  controlNumber: string;
  declaredSegmentCount: number | null;
  segmentCount: number;
  poNumber: string | null;
  invoiceNumber: string | null;
  purpose: string | null;
  // Phase 8 Sprint 1 — direction + outbound lifecycle timestamps surface on the
  // detail response so the web can render the stage timeline.
  direction: 'inbound' | 'outbound' | 'unknown';
  generatedAt: Date | null;
  transmittedAt: Date | null;
  confirmedAt: Date | null;
  segments?: SegmentRow[];
  functionalGroup?: { controlNumber?: string; interchange?: InterchangeRow | null } | null;
}

interface TransactionWhere {
  transactionSetId?: string;
  poNumber?: string;
  invoiceNumber?: string;
  direction?: LifecycleDirection;
  functionalGroup?: {
    interchange?: {
      OR?: Array<{ senderId?: string; receiverId?: string }>;
      rawFile?: { status?: RawFileStatus; ingestedAt?: { gte?: Date; lte?: Date } };
    };
  };
}

const LIST_INCLUDE = { functionalGroup: { include: { interchange: { include: { rawFile: true } } } } };

function toSummary(row: TransactionRow): TransactionSummary {
  const ic = row.functionalGroup?.interchange ?? null;
  return {
    id: row.id,
    transactionSetId: row.transactionSetId,
    controlNumber: row.controlNumber,
    poNumber: row.poNumber,
    invoiceNumber: row.invoiceNumber,
    purpose: row.purpose,
    senderId: ic?.senderId ?? null,
    receiverId: ic?.receiverId ?? null,
    status: ic?.rawFile?.status ?? null,
    ingestedAt: ic?.rawFile?.ingestedAt ? ic.rawFile.ingestedAt.toISOString() : null,
    direction: row.direction,
  };
}

const DIRECTION_SET = new Set<LifecycleDirection>(LIFECYCLE_DIRECTIONS);

function toDecomposed(row: TransactionRow): DecomposedTransaction {
  const segments = [...(row.segments ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      tag: s.tag,
      position: s.position,
      elements: [...s.elements].sort((a, b) => a.index - b.index).map((e) => ({ index: e.index, value: e.value })),
    }));
  return {
    transactionSetId: row.transactionSetId,
    controlNumber: row.controlNumber,
    declaredSegmentCount: row.declaredSegmentCount,
    segmentCount: row.segmentCount,
    segments,
  };
}

const STATUS_SET = new Set<RawFileStatus>(['RECEIVED', 'DUPLICATE', 'PARSED', 'PARSE_ERROR', 'UNRECOGNIZED_FORMAT', 'FAILED']);

export async function transactionRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get<{ Params: { id: string } }>('/transactions/:id', requiresRole('viewer'), async (request, reply) => {
    const row = (await app.prisma.transaction.findUnique({
      where: { id: request.params.id },
      include: { segments: { include: { elements: true } }, ...LIST_INCLUDE },
    })) as TransactionRow | null;

    if (!row) {
      const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'No transaction with that id.' } };
      return reply.code(404).send(body);
    }

    const ic = row.functionalGroup?.interchange ?? null;
    const groupControl = row.functionalGroup?.controlNumber ?? '';
    const rejection = groupControl
      ? await findRejectionFor(app.prisma, {
          id: row.id,
          transactionSetId: row.transactionSetId,
          controlNumber: row.controlNumber,
          groupControlNumber: groupControl,
        })
      : null;
    return reply.code(200).send({
      ...toSummary(row),
      rawFileId: ic?.rawFile?.id ?? null,
      errorMessage: ic?.rawFile?.errorMessage ?? null,
      declaredSegmentCount: row.declaredSegmentCount,
      segmentCount: row.segmentCount,
      delimiters: ic
        ? { element: ic.elementSeparator, subElement: ic.subElementSeparator, segment: ic.segmentTerminator }
        : null,
      interpreted: interpretTransaction(toDecomposed(row)),
      rejection,
      // Phase 8 Sprint 1 — direction + outbound lifecycle for the stage timeline.
      // All four are null/'unknown' for predecessors that pre-date Phase 8 and
      // haven't been backfilled; the web component handles those cases.
      direction: row.direction,
      generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
      transmittedAt: row.transmittedAt ? row.transmittedAt.toISOString() : null,
      confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
      outboundStage: deriveOutboundStage(row.generatedAt, row.transmittedAt, row.confirmedAt),
      segments: [...(row.segments ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((s) => ({
          tag: s.tag,
          position: s.position,
          elements: [...s.elements]
            .sort((a, b) => a.index - b.index)
            .map((e) => ({ index: e.index, value: e.value, semanticLabel: e.semanticLabel })),
        })),
    });
  });

  app.get<{
    Querystring: { set?: string; po?: string; invoice?: string; partner?: string; status?: string; direction?: string; from?: string; to?: string; limit?: string; offset?: string };
  }>('/transactions', requiresRole('viewer'), async (request, reply) => {
    const q = request.query;
    const where: TransactionWhere = {};
    if (q.set) where.transactionSetId = q.set;
    if (q.po) where.poNumber = q.po;
    if (q.invoice) where.invoiceNumber = q.invoice;
    if (q.direction && DIRECTION_SET.has(q.direction as LifecycleDirection)) {
      where.direction = q.direction as LifecycleDirection;
    }

    const interchange: NonNullable<TransactionWhere['functionalGroup']>['interchange'] = {};
    if (q.partner) interchange.OR = [{ senderId: q.partner }, { receiverId: q.partner }];
    const rawFile: { status?: RawFileStatus; ingestedAt?: { gte?: Date; lte?: Date } } = {};
    if (q.status && STATUS_SET.has(q.status as RawFileStatus)) rawFile.status = q.status as RawFileStatus;
    if (q.from || q.to) {
      rawFile.ingestedAt = {};
      if (q.from) rawFile.ingestedAt.gte = new Date(q.from);
      if (q.to) rawFile.ingestedAt.lte = new Date(q.to);
    }
    if (Object.keys(rawFile).length > 0) interchange.rawFile = rawFile;
    if (interchange.OR || interchange.rawFile) where.functionalGroup = { interchange };

    const limit = Math.min(Math.max(Number.parseInt(q.limit ?? '25', 10) || 25, 1), 100);
    const offset = Math.max(Number.parseInt(q.offset ?? '0', 10) || 0, 0);

    const rows = (await app.prisma.transaction.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: { functionalGroup: { interchange: { rawFile: { ingestedAt: 'desc' } } } },
      take: limit,
      skip: offset,
    })) as TransactionRow[];

    const body: TransactionListResponse = { items: rows.map(toSummary), limit, offset, count: rows.length };
    return reply.code(200).send(body);
  });
}
