/**
 * Phase 5 — per-partner rejection-rate metric.
 *
 * For every 997/999 ingested in the window, count its ackedTxnControls
 * entries by AK5 status. "Partner" is the interchange counter-party (the side
 * that isn't in OUR_ISA_IDS); if OUR_ISA_IDS is empty we fall back to the
 * 997's senderId (the partner acking us is the trading partner of interest).
 *
 * Per Gate C the rejected count is strict: AK5 = R or M only. `E` (accepted
 * with errors) and `P` (partial) are NOT counted.
 *
 * Aggregation runs in-memory after a single SQL query. At pilot scale this is
 * fast and avoids JSONB-aware SQL; if volume ever justifies it we can move
 * the aggregation to a materialized view.
 */
import type { PrismaClient } from '@prisma/client';
import type { RejectionRateRow } from '@edi/shared';

export interface GetRejectionRateInput {
  from: Date;
  to: Date;
  /** Optional filter; when provided, returns only that partner's row. */
  partner?: string;
  /** OUR_ISA_IDS — the hub operator's identifiers. */
  ourIsaIds: readonly string[];
}

interface AckRow {
  ackedTxnControls: unknown;
  functionalGroup: {
    interchange: {
      senderId: string;
      receiverId: string;
    };
  };
}

/** Decide which side of the interchange is the trading partner. */
function partnerOf(senderId: string, receiverId: string, ourIsaIds: readonly string[]): string {
  if (ourIsaIds.length === 0) return senderId || receiverId || 'unknown';
  const senderIsUs = ourIsaIds.includes(senderId);
  const receiverIsUs = ourIsaIds.includes(receiverId);
  if (senderIsUs && !receiverIsUs) return receiverId || 'unknown';
  if (receiverIsUs && !senderIsUs) return senderId || 'unknown';
  return 'unknown';
}

export async function getRejectionRate(
  prisma: PrismaClient,
  input: GetRejectionRateInput,
): Promise<RejectionRateRow[]> {
  const rows = (await prisma.transaction.findMany({
    where: {
      transactionSetId: { in: ['997', '999'] },
      functionalGroup: {
        interchange: { rawFile: { ingestedAt: { gte: input.from, lte: input.to } } },
      },
    },
    include: {
      functionalGroup: { include: { interchange: { include: { rawFile: true } } } },
    },
  })) as unknown as AckRow[];

  // Accumulator keyed by partner.
  const acc = new Map<string, { total: number; rejected: number }>();
  for (const row of rows) {
    const partner = partnerOf(
      row.functionalGroup.interchange.senderId,
      row.functionalGroup.interchange.receiverId,
      input.ourIsaIds,
    );
    if (input.partner && partner !== input.partner) continue;
    if (!Array.isArray(row.ackedTxnControls)) continue;
    const entries = row.ackedTxnControls as Array<Record<string, unknown>>;
    const bucket = acc.get(partner) ?? { total: 0, rejected: 0 };
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue;
      bucket.total += 1;
      const status = String(e.status ?? '');
      if (status === 'R' || status === 'M') bucket.rejected += 1;
    }
    acc.set(partner, bucket);
  }

  const out: RejectionRateRow[] = [];
  for (const [partner, b] of acc) {
    out.push({
      partner,
      total: b.total,
      rejected: b.rejected,
      rate: b.total > 0 ? b.rejected / b.total : 0,
    });
  }
  // Sort by rate desc (highest-attention partners first), then partner asc.
  out.sort((a, b) => (b.rate - a.rate) || a.partner.localeCompare(b.partner));
  return out;
}
