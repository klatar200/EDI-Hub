/**
 * Phase 5 — given an original transaction (e.g. an 850), find the 997 that
 * acked it (if any) and surface the structured rejection detail when its
 * AK5 was R or M (the strict rejection definition from Gate C).
 *
 * Used by `GET /transactions/:id` to render the "Rejected because:" panel
 * on a transaction-detail page without making the UI go fetch the lifecycle.
 */
import type { PrismaClient } from '@prisma/client';
import type {
  RejectionElementError,
  RejectionSegmentError,
  TransactionRejection,
} from '@edi/shared';

interface OriginalRef {
  id: string;
  transactionSetId: string;
  controlNumber: string;
  /** GS06 of the group that holds this transaction. */
  groupControlNumber: string;
}

/** Defensive shape readers for JSONB → typed errors. */
function readSegmentErrors(raw: unknown): RejectionSegmentError[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map((e) => ({
      segmentTag: String(e.segmentTag ?? ''),
      segmentPosition: String(e.segmentPosition ?? ''),
      loopIdentifier: String(e.loopIdentifier ?? ''),
      syntaxErrorCode: String(e.syntaxErrorCode ?? ''),
      syntaxErrorMessage: typeof e.syntaxErrorMessage === 'string' ? e.syntaxErrorMessage : null,
      elementErrors: readElementErrors(e.elementErrors),
    }));
}

function readElementErrors(raw: unknown): RejectionElementError[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map((e) => ({
      elementPosition: String(e.elementPosition ?? ''),
      dataElementReference: String(e.dataElementReference ?? ''),
      syntaxErrorCode: String(e.syntaxErrorCode ?? ''),
      syntaxErrorMessage: typeof e.syntaxErrorMessage === 'string' ? e.syntaxErrorMessage : null,
      badValue: String(e.badValue ?? ''),
    }));
}

/** Build a one-line plain-English summary. Prefers first element error. */
export function summarizeRejection(errors: RejectionSegmentError[]): string | null {
  if (errors.length === 0) return null;
  const first = errors[0]!;
  const firstEl = first.elementErrors[0];
  if (firstEl) {
    const tag = first.segmentTag && firstEl.elementPosition
      ? `${first.segmentTag}${firstEl.elementPosition.padStart(2, '0')}`
      : first.segmentTag || `element ${firstEl.elementPosition}`;
    const msg = firstEl.syntaxErrorMessage ?? `code ${firstEl.syntaxErrorCode}`;
    return `${tag} — ${msg}`;
  }
  const segMsg = first.syntaxErrorMessage ?? `code ${first.syntaxErrorCode}`;
  return first.segmentTag ? `${first.segmentTag} — ${segMsg}` : segMsg;
}

/** Find the first 997 (if any) that rejected this original transaction. */
export async function findRejectionFor(
  prisma: PrismaClient,
  original: OriginalRef,
): Promise<TransactionRejection | null> {
  if (original.transactionSetId === '997' || original.transactionSetId === '999') return null;

  type AckRow = {
    id: string;
    ackedTxnControls: unknown;
    functionalGroup: { interchange: { rawFile: { id: string } } };
  };
  const candidates = (await prisma.transaction.findMany({
    where: {
      transactionSetId: { in: ['997', '999'] },
      ackedGroupControl: original.groupControlNumber,
    },
    include: { functionalGroup: { include: { interchange: { include: { rawFile: true } } } } },
  })) as unknown as AckRow[];

  for (const ack of candidates) {
    if (!Array.isArray(ack.ackedTxnControls)) continue;
    const entries = ack.ackedTxnControls as Array<Record<string, unknown>>;
    const hit = entries.find(
      (e) =>
        e &&
        typeof e === 'object' &&
        String(e.setId ?? '') === original.transactionSetId &&
        String(e.control ?? '') === original.controlNumber,
    );
    if (!hit) continue;
    const status = String(hit.status ?? '');
    // Strict rejection definition — Gate C: AK5 R or M only.
    if (status !== 'R' && status !== 'M') continue;
    const details = readSegmentErrors(hit.errors);
    return {
      ackTransactionId: ack.id,
      ackRawFileId: ack.functionalGroup.interchange.rawFile.id,
      status,
      statusMessage: typeof hit.statusMessage === 'string' ? hit.statusMessage : null,
      summary: summarizeRejection(details),
      details,
    };
  }
  return null;
}
