/**
 * GET /search?q= — lifecycle-first search: PO conversations, then transactions, then raw ISA.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type {
  ApiErrorResponse,
  LifecycleSearchHit,
  RawFileRecord,
  RawFileStatus,
  SearchResponse,
  SourceChannel,
  TransactionSummary,
} from '@edi/shared';
import { requiresRole } from '../plugins/rbac.js';
import { getLifecycle } from '../services/lifecycle.js';

interface InterchangeRow { senderId: string; receiverId: string; rawFile?: { status: RawFileStatus; ingestedAt: Date } | null }
interface TransactionRow {
  id: string; transactionSetId: string; controlNumber: string;
  poNumber: string | null; invoiceNumber: string | null; purpose: string | null;
  direction: 'inbound' | 'outbound' | 'unknown';
  functionalGroup?: { interchange?: InterchangeRow | null } | null;
}
interface RawFileRow {
  id: string; s3Key: string; fileHash: string; isaControlNumber: string | null;
  source: SourceChannel; status: RawFileStatus; errorMessage: string | null; ingestedAt: Date;
}

const INCLUDE = { functionalGroup: { include: { interchange: { include: { rawFile: true } } } } };

function txSummary(row: TransactionRow): TransactionSummary {
  const ic = row.functionalGroup?.interchange ?? null;
  return {
    id: row.id, transactionSetId: row.transactionSetId, controlNumber: row.controlNumber,
    poNumber: row.poNumber, invoiceNumber: row.invoiceNumber, purpose: row.purpose,
    senderId: ic?.senderId ?? null, receiverId: ic?.receiverId ?? null,
    status: ic?.rawFile?.status ?? null,
    ingestedAt: ic?.rawFile?.ingestedAt ? ic.rawFile.ingestedAt.toISOString() : null,
    direction: row.direction,
  };
}

function rawRecord(r: RawFileRow): RawFileRecord {
  return {
    id: r.id, s3Key: r.s3Key, fileHash: r.fileHash, isaControlNumber: r.isaControlNumber,
    source: r.source, status: r.status, errorMessage: r.errorMessage, ingestedAt: r.ingestedAt.toISOString(),
  };
}

export async function searchRoutes(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
  app.get<{ Querystring: { q?: string } }>('/search', requiresRole('viewer'), async (request, reply) => {
    const query = (request.query.q ?? '').trim();
    if (query === '') {
      const body: ApiErrorResponse = { error: { code: 'BAD_REQUEST', message: 'Provide a search term via ?q=' } };
      return reply.code(400).send(body);
    }

    const tenant = request.tenantId
      ? await app.prisma.tenant.findUnique({
          where: { id: request.tenantId },
          select: { ourIsaIds: true },
        })
      : null;
    const ourIsaIds = tenant?.ourIsaIds ?? [];

    const lifecycles: LifecycleSearchHit[] = [];

    async function tryLifecycleHit(po: string): Promise<void> {
      if (lifecycles.some((l) => l.po === po)) return;
      try {
        const lc = await getLifecycle(app.prisma, { po }, { ourIsaIds });
        if (!lc) return;
        const last = lc.events
          .filter((e) => e.kind === 'transaction' && e.ingestedAt)
          .map((e) => e.ingestedAt as string)
          .sort()
          .at(-1) ?? new Date().toISOString();
        const activeAlerts = await app.prisma.alert.findMany({
          where: { status: 'active' },
          select: { sourceRef: true },
        });
        const openAlertCount = activeAlerts.filter((a) => {
          const ref = a.sourceRef as Record<string, unknown>;
          return ref.poNumber === po;
        }).length;
        lifecycles.push({
          po,
          partnerDisplayName: lc.partner?.displayName ?? null,
          lastActivityAt: last,
          openAlertCount,
        });
      } catch {
        // Fallback when lifecycle resolution needs a fuller Prisma graph (e.g. unit fakes).
        const txns = await app.prisma.transaction.findMany({
          where: { poNumber: po },
          include: INCLUDE,
          take: 1,
        }) as TransactionRow[];
        if (txns.length === 0) return;
        const first = txns[0]!;
        lifecycles.push({
          po,
          partnerDisplayName: null,
          lastActivityAt: first.functionalGroup?.interchange?.rawFile?.ingestedAt?.toISOString()
            ?? new Date().toISOString(),
          openAlertCount: 0,
        });
      }
    }

    await tryLifecycleHit(query);

    const [byPo, byInvoice, byShipment, rawByIsa] = await Promise.all([
      app.prisma.transaction.findMany({ where: { poNumber: query }, include: INCLUDE, take: 50 }) as Promise<TransactionRow[]>,
      app.prisma.transaction.findMany({ where: { invoiceNumber: query }, include: INCLUDE, take: 50 }) as Promise<TransactionRow[]>,
      getLifecycle(app.prisma, { shipment: query }, { ourIsaIds })
        .then(async (sh) => {
          if (!sh) return [] as TransactionRow[];
          return app.prisma.transaction.findMany({
            where: { poNumber: sh.po },
            include: INCLUDE,
            take: 50,
          }) as Promise<TransactionRow[]>;
        })
        .catch(() => [] as TransactionRow[]),
      request.tenantId
        ? (app.prisma.rawFile.findUnique({
            where: { tenantId_isaControlNumber: { tenantId: request.tenantId, isaControlNumber: query } },
          }) as Promise<RawFileRow | null>)
        : Promise.resolve(null),
    ]);

    const seenPo = new Set(lifecycles.map((l) => l.po));
    try {
      const shipmentLc = await getLifecycle(app.prisma, { shipment: query }, { ourIsaIds });
      if (shipmentLc && !seenPo.has(shipmentLc.po)) {
        seenPo.add(shipmentLc.po);
        lifecycles.push({
          po: shipmentLc.po,
          partnerDisplayName: shipmentLc.partner?.displayName ?? null,
          lastActivityAt: new Date().toISOString(),
          openAlertCount: 0,
        });
      }
    } catch {
      // shipment resolution optional
    }
    for (const row of [...byPo, ...byInvoice]) {
      if (!row.poNumber || seenPo.has(row.poNumber)) continue;
      await tryLifecycleHit(row.poNumber);
      seenPo.add(row.poNumber);
    }

    const seen = new Set<string>();
    const transactions: TransactionSummary[] = [];
    for (const row of [...byPo, ...byInvoice, ...byShipment]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      transactions.push(txSummary(row));
    }

    const body: SearchResponse = {
      query,
      lifecycles,
      transactions,
      rawFiles: rawByIsa ? [rawRecord(rawByIsa)] : [],
    };
    return reply.code(200).send(body);
  });
}
