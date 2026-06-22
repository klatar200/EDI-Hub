/**
 * GET /search?q= — resolve a free-text token to matching transactions (by PO or
 * invoice number) and/or a raw file (by ISA control number). The global search
 * box routes straight to whatever matches.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ApiErrorResponse, RawFileRecord, RawFileStatus, SearchResponse, SourceChannel, TransactionSummary } from '@edi/shared';

import { requiresRole } from '../plugins/rbac.js';
interface InterchangeRow { senderId: string; receiverId: string; rawFile?: { status: RawFileStatus; ingestedAt: Date } | null }
interface TransactionRow {
  id: string; transactionSetId: string; controlNumber: string;
  poNumber: string | null; invoiceNumber: string | null; purpose: string | null;
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

    const [byPo, byInvoice, rawByIsa] = await Promise.all([
      app.prisma.transaction.findMany({ where: { poNumber: query }, include: INCLUDE, take: 50 }) as Promise<TransactionRow[]>,
      app.prisma.transaction.findMany({ where: { invoiceNumber: query }, include: INCLUDE, take: 50 }) as Promise<TransactionRow[]>,
      app.prisma.rawFile.findUnique({ where: { isaControlNumber: query } }) as Promise<RawFileRow | null>,
    ]);

    const seen = new Set<string>();
    const transactions: TransactionSummary[] = [];
    for (const row of [...byPo, ...byInvoice]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      transactions.push(txSummary(row));
    }

    const body: SearchResponse = { query, transactions, rawFiles: rawByIsa ? [rawRecord(rawByIsa)] : [] };
    return reply.code(200).send(body);
  });
}
