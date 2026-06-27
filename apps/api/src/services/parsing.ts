/**
 * parseAndStore — decompose a stored raw file and persist its full
 * interchange -> group -> transaction -> segment -> element tree.
 *
 * Idempotent: any existing parsed tree for the raw file is deleted and rebuilt
 * inside one DB transaction, so re-parsing never duplicates rows. The raw file
 * itself is never modified. A parse failure flags the raw file `PARSE_ERROR`
 * (with a useful message) rather than crashing the pipeline.
 *
 * Phase 4 Sprint 1 adds lifecycle linkage to each persisted transaction:
 *   - shipmentId (from 856 BSN02)
 *   - ackedGroupControl / ackedTxnControls / ackStatus (from 997/999)
 *   - direction (inbound/outbound, computed from OUR_ISA_IDS)
 */
import type { S3Client } from '@aws-sdk/client-s3';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { tenantContext } from '@edi/db';
import {
  decomposeInterchange,
  EdiParseError,
  extractAck,
  extractBusinessKeys,
  labelFor,
  validateTransaction,
  type DecomposedInterchange,
  type TransactionIssue,
} from '@edi/edi-parser';
import type { AppConfig } from '../config.js';
import type { StorageAdapter } from '../storage/interface.js';
import { resolvePartnerByIsa } from './partners.js';

/**
 * Tag a transaction's direction relative to the configured "us" identifiers.
 * Pre-Phase 9 this is a global list; Phase 9 makes it per-tenant.
 *
 * Returns `unknown` when no IDs are configured, when neither side matches, or
 * when both sides match (intra-tenant traffic — meaningless direction).
 */
export type Direction = 'inbound' | 'outbound' | 'unknown';
export function computeDirection(
  senderId: string,
  receiverId: string,
  ourIds: readonly string[],
): Direction {
  if (ourIds.length === 0) return 'unknown';
  const senderIsUs = ourIds.includes(senderId);
  const receiverIsUs = ourIds.includes(receiverId);
  if (receiverIsUs && !senderIsUs) return 'inbound';
  if (senderIsUs && !receiverIsUs) return 'outbound';
  return 'unknown';
}

export interface ParsingDeps {
  s3: S3Client;
  /** Desktop track D3 Sprint 1 - data-path storage adapter. */
  storage: StorageAdapter;
  prisma: PrismaClient;
  config: AppConfig;
  logger: FastifyBaseLogger;
}

export type ParseOutcome =
  | {
      outcome: 'parsed';
      interchangeId: string;
      groups: number;
      transactions: number;
      segments: number;
      warnings: string[];
      issues: TransactionIssue[];
      status: 'PARSED' | 'PARSE_ERROR';
    }
  | { outcome: 'parse_error'; error: string }
  | { outcome: 'skipped'; reason: string };

/** Map the decomposed tree into a Prisma nested-create payload. */
function buildInterchangeCreate(
  rawFileId: string,
  ic: DecomposedInterchange,
  ourIsaIds: readonly string[],
  partnerSupportedSets: readonly string[],
  ingestedAt: Date,
  tenantId: string,
) {
  // Direction is a property of the interchange's sender/receiver pair, so it's
  // identical for every transaction inside this interchange. Compute once.
  const direction = computeDirection(ic.senderId, ic.receiverId, ourIsaIds);

  // Phase 8 Sprint 1 — outbound transactions carry generated + transmitted
  // timestamps at parse time. Per Gate A we can't honestly distinguish
  // generated from transmitted without an upstream ERP signal, so both land
  // on `ingestedAt`. confirmedAt is set later by acknowledgment arrival
  // (Sprint 1.3). Inbound and unknown transactions leave all three null.
  const outboundTimestamps =
    direction === 'outbound'
      ? { generatedAt: ingestedAt, transmittedAt: ingestedAt }
      : {};

  return {
    // Phase 9 Sprint 1 — tenantId on the top-level Interchange and every
    // nested create. The Prisma tenant extension would inject these from the
    // active context, but the typed CreateInput surface still requires them
    // at compile time. Threading the value explicitly matches our "tenant is
    // a load-bearing field, not an implicit default" posture.
    tenantId,
    rawFileId,
    isaControlNumber: ic.isaControlNumber,
    senderId: ic.senderId,
    receiverId: ic.receiverId,
    version: ic.version,
    declaredGroupCount: ic.declaredGroupCount,
    elementSeparator: ic.delimiters.element,
    subElementSeparator: ic.delimiters.subElement,
    segmentTerminator: ic.delimiters.segment,
    functionalGroups: {
      create: ic.groups.map((g) => ({
        tenantId,
        functionalIdCode: g.functionalIdCode,
        controlNumber: g.controlNumber,
        version: g.version,
        declaredTransactionCount: g.declaredTransactionCount,
        transactions: {
          create: g.transactions.map((t) => {
            const keys = extractBusinessKeys(t);
            const ack = extractAck(t); // null for non-997/999.
            // Phase 6 Sprint 2 — when the partner has a supported-sets allow
            // list, any txn whose set isn't on it is flagged UNCONFIGURED_SET
            // (Gate D: accept and warn, never reject). No allow list → null.
            const configFlag =
              partnerSupportedSets.length > 0 && !partnerSupportedSets.includes(t.transactionSetId)
                ? 'UNCONFIGURED_SET'
                : null;
            return {
              tenantId,
              transactionSetId: t.transactionSetId,
              controlNumber: t.controlNumber,
              declaredSegmentCount: t.declaredSegmentCount,
              segmentCount: t.segmentCount,
              poNumber: keys.poNumber,
              invoiceNumber: keys.invoiceNumber,
              purpose: keys.purpose,
              shipmentId: keys.shipmentId,
              ackedGroupControl: ack?.groupControl || null,
              // Prisma's Json InputJsonObject requires a string index signature;
              // our typed AckedTransaction interface doesn't have one, so cast
              // through unknown. Undefined (rather than null) writes SQL NULL.
              ackedTxnControls: ack
                ? (ack.transactions as unknown as Prisma.InputJsonValue)
                : undefined,
              ackStatus: ack?.groupStatus || null,
              direction,
              configFlag,
              ...outboundTimestamps,
              segments: {
                create: t.segments.map((s) => ({
                  tenantId,
                  tag: s.tag,
                  position: s.position,
                  elements: {
                    create: s.elements.map((e) => ({
                      tenantId,
                      index: e.index,
                      value: e.value,
                      semanticLabel: labelFor(t.transactionSetId, s.tag, e.index),
                    })),
                  },
                })),
              },
            };
          }),
        },
      })),
    },
  };
}

function countTree(ic: DecomposedInterchange): { groups: number; transactions: number; segments: number } {
  let transactions = 0;
  let segments = 0;
  for (const g of ic.groups) {
    transactions += g.transactions.length;
    for (const t of g.transactions) segments += t.segments.length;
  }
  return { groups: ic.groups.length, transactions, segments };
}

// ─────────────────────────────────────────────────────────────
// Phase 8 Sprint 1 — confirmedAt propagation.
//
// When a 997/999 ack is persisted, every outbound original it acknowledges
// gets its `confirmedAt` set to the ack's ingestedAt. We do this off the
// already-persisted DB rows (not the in-memory parser output) so the logic
// is identical for live ingestion and historical backfill.
//
// Match rule (mirrors lifecycle stitching):
//   ack.ackedGroupControl == original.functionalGroup.controlNumber
//   AND ack.ackedTxnControls contains { setId: original.transactionSetId,
//                                       control: original.controlNumber }
//
// Why we only touch outbound originals: an inbound ack confirms our outbound
// transaction. An outbound ack (us acking the partner's inbound) is operational
// noise for confirmedAt purposes — they don't have a `confirmedAt` column
// because inbound state isn't tracked on the three-timestamp axis.
// ─────────────────────────────────────────────────────────────

/** Minimal Prisma client surface used by the propagation helpers. Both
 *  `PrismaClient` and `Prisma.TransactionClient` satisfy it. */
type PrismaLike = Pick<PrismaClient, 'transaction'>;

interface AckRow {
  id: string;
  ackedGroupControl: string | null;
  ackedTxnControls: unknown;
  functionalGroup: { interchange: { rawFile: { ingestedAt: Date } } };
}

interface AckTxnEntry {
  setId: string;
  control: string;
}

function parseAckEntries(raw: unknown): AckTxnEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map((e) => ({ setId: String(e.setId ?? ''), control: String(e.control ?? '') }))
    .filter((e) => e.setId && e.control);
}

/**
 * Given a set of ack transactions, set `confirmedAt` on every outbound
 * original they acknowledge. Returns the count of originals updated.
 *
 * The update uses `confirmedAt: null` as a guard so a later ack arriving on a
 * re-parse never overwrites an earlier confirmation. (The earliest ack wins,
 * which is the operationally correct semantics — the partner confirmed at
 * the earlier time, not the time the file was reprocessed.)
 */
async function propagateConfirmedAtForAcks(
  prisma: PrismaLike,
  acks: readonly AckRow[],
): Promise<number> {
  let updated = 0;
  for (const ack of acks) {
    const entries = parseAckEntries(ack.ackedTxnControls);
    if (entries.length === 0 || !ack.ackedGroupControl) continue;
    const ackedAt = ack.functionalGroup.interchange.rawFile.ingestedAt;
    // One UPDATE per ack covers all the (setId, control) pairs it acknowledges,
    // keyed through the functional group's GS06.
    const result = await prisma.transaction.updateMany({
      where: {
        direction: 'outbound',
        confirmedAt: null,
        functionalGroup: { controlNumber: ack.ackedGroupControl },
        OR: entries.map((e) => ({
          transactionSetId: e.setId,
          controlNumber: e.control,
        })),
      },
      data: { confirmedAt: ackedAt },
    });
    updated += result.count;
  }
  return updated;
}

/** Used inside the parse $transaction — restricted to acks from this rawFile. */
async function propagateConfirmedAtForRawFile(
  tx: PrismaLike,
  rawFileId: string,
  ackIngestedAt: Date,
): Promise<number> {
  const acks = await tx.transaction.findMany({
    where: {
      transactionSetId: { in: ['997', '999'] },
      functionalGroup: { interchange: { rawFileId } },
    },
    select: {
      id: true,
      ackedGroupControl: true,
      ackedTxnControls: true,
      functionalGroup: {
        select: { interchange: { select: { rawFile: { select: { ingestedAt: true } } } } },
      },
    },
  });
  if (acks.length === 0) return 0;
  // Override the per-ack ingestedAt with the rawFile's ingestedAt — they're
  // the same row by construction, but Prisma's nested select gives us a
  // typed shape we can hand directly to the propagator.
  void ackIngestedAt;
  return propagateConfirmedAtForAcks(tx, acks as unknown as AckRow[]);
}

/**
 * Backfill helper — scan every persisted 997/999 in the DB and update each
 * matched outbound original's `confirmedAt`. Idempotent: the `confirmedAt is
 * null` guard means rerunning is a no-op once everything is stitched.
 *
 * Exposed for the standalone backfill script. Pass the project's prisma
 * client; this function does its own scan.
 */
export async function backfillConfirmedAt(prisma: PrismaClient): Promise<number> {
  const acks = await prisma.transaction.findMany({
    where: { transactionSetId: { in: ['997', '999'] } },
    select: {
      id: true,
      ackedGroupControl: true,
      ackedTxnControls: true,
      functionalGroup: {
        select: { interchange: { select: { rawFile: { select: { ingestedAt: true } } } } },
      },
    },
  });
  return propagateConfirmedAtForAcks(prisma, acks as unknown as AckRow[]);
}

export async function parseAndStore(
  deps: ParsingDeps,
  input: { rawFileId: string; content?: Buffer },
): Promise<ParseOutcome> {
  const raw = await deps.prisma.rawFile.findUnique({ where: { id: input.rawFileId } });
  if (!raw) return { outcome: 'skipped', reason: 'raw file not found' };

  const content =
    input.content ?? (await deps.storage.download(raw.s3Key));

  let decomposed;
  try {
    decomposed = decomposeInterchange(content.toString('latin1'));
  } catch (err) {
    if (!(err instanceof EdiParseError)) throw err;
    await deps.prisma.rawFile.update({
      where: { id: raw.id },
      data: { status: 'PARSE_ERROR', errorMessage: err.message },
    });
    deps.logger.warn({ rawFileId: raw.id, reason: err.message }, 'Decomposition failed; flagged PARSE_ERROR');
    return { outcome: 'parse_error', error: err.message };
  }

  const { interchange, warnings } = decomposed;
  const counts = countTree(interchange);

  // Per-transaction semantic validation. The generic tree is persisted no
  // matter what; an error-severity issue flags the file PARSE_ERROR while
  // sibling transactions are still stored and parsed.
  const issues: TransactionIssue[] = [];
  for (const g of interchange.groups) {
    for (const t of g.transactions) issues.push(...validateTransaction(t));
  }
  const errors = issues.filter((i) => i.severity === 'error');
  const finalStatus: 'PARSED' | 'PARSE_ERROR' = errors.length > 0 ? 'PARSE_ERROR' : 'PARSED';
  const errorMessage =
    errors.length > 0
      ? errors.map((e) => `[${e.transactionSetId} ${e.controlNumber}] ${e.message}`).join(' ')
      : null;

  // Phase 9 Sprint 1.4 — OUR_ISA_IDS moved from env to the tenant row.
  // Tenant lookups bypass the tenant extension (Tenant is exempt) but still
  // require the active context to be set. The Fastify preHandler sets it for
  // request-scoped parses; backfill scripts wrap their call in
  // tenantContext.run(...) before invoking parseAndStore.
  const tenantId = tenantContext.requireTenantId();
  const tenant = await deps.prisma.tenant.findUnique({ where: { id: tenantId } });
  const ourIsaIds = tenant?.ourIsaIds ?? [];

  // Phase 6 — resolve the configured partner (if any) so we can apply
  // their supported-sets allow list during persistence. Failure to resolve is
  // not an error; we just fall back to no allow list (Phase 5 behavior).
  const partner = await resolvePartnerByIsa(
    deps.prisma,
    interchange.senderId,
    interchange.receiverId,
    ourIsaIds,
  );
  const data = buildInterchangeCreate(
    raw.id,
    interchange,
    ourIsaIds,
    partner?.supportedSets ?? [],
    raw.ingestedAt,
    tenantId,
  );
  const created = await deps.prisma.$transaction(async (tx) => {
    await tx.interchange.deleteMany({ where: { rawFileId: raw.id } });
    const ic = await tx.interchange.create({ data });
    await tx.rawFile.update({ where: { id: raw.id }, data: { status: finalStatus, errorMessage } });
    // Phase 8 Sprint 1 — when this interchange contained 997/999 acks,
    // propagate confirmedAt onto each outbound original they acknowledge.
    // Lives inside the same $transaction as the persisted tree so a failure
    // here rolls the whole parse back; idempotent on re-parse because the
    // interchange tree was deleteMany'd above.
    await propagateConfirmedAtForRawFile(tx, raw.id, raw.ingestedAt);
    return ic;
  });

  deps.logger.info(
    { rawFileId: raw.id, interchangeId: created.id, ...counts, status: finalStatus, warnings: warnings.length, errors: errors.length },
    'Parsed and stored interchange',
  );
  if (warnings.length > 0 || issues.length > 0) {
    deps.logger.warn({ rawFileId: raw.id, warnings, issues }, 'Parse completed with warnings/issues');
  }
  return { outcome: 'parsed', interchangeId: created.id, ...counts, warnings, issues, status: finalStatus };
}

/** PS-5 — re-read raw from storage and re-run parse pipeline. */
export async function reparseRawFile(deps: ParsingDeps, rawFileId: string): Promise<ParseOutcome> {
  return parseAndStore(deps, { rawFileId });
}

const DEFAULT_RECONCILE_MINUTES = 15;

/** PS-5 — on API boot, re-parse RECEIVED rows stuck past N minutes. */
export async function reconcileStuckReceived(
  deps: ParsingDeps,
  options: { olderThanMinutes?: number } = {},
): Promise<number> {
  const minutes = options.olderThanMinutes ?? DEFAULT_RECONCILE_MINUTES;
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  const stuck = await deps.prisma.rawFile.findMany({
    where: { status: 'RECEIVED', ingestedAt: { lt: cutoff } },
    select: { id: true },
  });
  for (const row of stuck) {
    await parseAndStore(deps, { rawFileId: row.id });
  }
  return stuck.length;
}
