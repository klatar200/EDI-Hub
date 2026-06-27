/**
 * Phase 4 — The North Star: transaction lifecycle stitching.
 *
 * `getLifecycle` takes a PO (or an invoice/shipment that resolves back to one)
 * and returns every related EDI document, in chronological order, with each
 * document's status derived from its 997 ack — plus any expected-but-missing
 * documents inserted as `gap` entries.
 *
 * The lifecycle service is pure read logic: it doesn't hardcode the canonical
 * 850→855→856→810 loop because the pilot's actual traffic is grocery-flavored
 * (850/860/875 inbound, 855/856/810/880 outbound). Instead, two **seed flows**
 * are defined as data — standard (850-based) and grocery (875-based) — so that
 * Phase 6 can externalize them per partner without restructuring this file.
 *
 * Acknowledgment linkage:
 *   A 997 acks a transaction T when
 *     997.ackedGroupControl == T.functionalGroup.controlNumber (GS06)
 *   AND
 *     997.ackedTxnControls contains { setId: T.transactionSetId, control: T.controlNumber }.
 *   The per-transaction status comes from AK5 inside that JSON entry.
 */
import type { PrismaClient } from '@prisma/client';
import {
  extractBusinessKeys,
  interpretTransaction,
  type DecomposedTransaction,
} from '@edi/edi-parser';
import {
  DEFAULT_GROCERY_FLOW,
  DEFAULT_STANDARD_FLOW,
  deriveOutboundStage,
  type LifecycleDirection,
  type LifecycleEvent,
  type LifecycleFlow,
  type LifecycleFlowDefinition,
  type LifecycleResponse,
  type LifecycleStatus,
  type RejectionElementError,
  type RejectionSegmentError,
  type SourceChannel,
  type TradingPartnerRecord,
} from '@edi/shared';
import { resolvePartnerByIsa } from './partners.js';
import { applyAckOverrides } from './ack-decoder.js';
import { computeDirection } from './parsing.js';

/** Sets that carry a PO reference in BAK/BIG/BCH when the indexed column is
 *  missing (e.g. files parsed before Phase 4 backfill, or a transient ingest
 *  bug). Lifecycle re-derives the PO from segments for these on the same
 *  trading-partner pair before declaring a gap. */
const ORPHAN_PO_SETS = ['855', '810', '856', '860', '880'] as const;

// ─────────────────────────────────────────────────────────────
// Seed flows. Intentionally data, not code branches — Phase 6
// makes these per-partner and editable in the UI.
// ─────────────────────────────────────────────────────────────

interface ExpectedDoc {
  setId: string;
  direction: LifecycleDirection;
}

// Phase 6 Sprint 2 — the shipped defaults now live in @edi/shared so the web
// and API agree on the canonical wording. The lifecycle service still works
// with `ExpectedDoc` internally; we adapt the shared shape on the way in.
function stepsOf(def: LifecycleFlowDefinition): readonly ExpectedDoc[] {
  return def.steps;
}
const STANDARD_FLOW: readonly ExpectedDoc[] = stepsOf(DEFAULT_STANDARD_FLOW);
const GROCERY_FLOW: readonly ExpectedDoc[] = stepsOf(DEFAULT_GROCERY_FLOW);

/** Pick the seed flow based on which sets are actually present. The grocery
 *  sets (875/880) win when either is seen — they don't co-exist with 850s in
 *  the pilot's chains. Otherwise default to the standard flow when an 850 is
 *  present; otherwise `unknown` (no gap rules apply). */
function determineFlow(setIdsPresent: ReadonlySet<string>): LifecycleFlow {
  if (setIdsPresent.has('875') || setIdsPresent.has('880')) return 'grocery';
  if (setIdsPresent.has('850')) return 'standard';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────
// Status derivation from an AK5 (per-transaction ack) code.
// X12 codes: A=accepted, E=accepted with errors, P=partial,
// R=rejected, M=auth-failure-rejected.
// ─────────────────────────────────────────────────────────────

function statusFromAk5(code: string): LifecycleStatus {
  switch (code) {
    case 'A':
    case 'E':
    case 'P':
      return 'acknowledged';
    case 'R':
    case 'M':
      return 'rejected';
    default:
      return 'received';
  }
}

// ─────────────────────────────────────────────────────────────
// Spine resolution: po | invoice | shipment → PO number.
// ─────────────────────────────────────────────────────────────

export interface LifecycleQuery {
  po?: string;
  invoice?: string;
  shipment?: string;
}

interface ResolvedSpine {
  po: string;
  enteredBy: LifecycleResponse['enteredBy'];
}

async function resolveSpine(
  prisma: PrismaClient,
  q: LifecycleQuery,
): Promise<ResolvedSpine | null> {
  if (q.po) return { po: q.po, enteredBy: { kind: 'po', value: q.po } };
  if (q.invoice) {
    const txn = await prisma.transaction.findFirst({
      where: { invoiceNumber: q.invoice, poNumber: { not: null } },
      select: { poNumber: true },
      orderBy: { id: 'asc' },
    });
    if (!txn?.poNumber) return null;
    return { po: txn.poNumber, enteredBy: { kind: 'invoice', value: q.invoice } };
  }
  if (q.shipment) {
    const txn = await prisma.transaction.findFirst({
      where: { shipmentId: q.shipment, poNumber: { not: null } },
      select: { poNumber: true },
      orderBy: { id: 'asc' },
    });
    if (!txn?.poNumber) return null;
    return { po: txn.poNumber, enteredBy: { kind: 'shipment', value: q.shipment } };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Row shapes (kept narrow so Prisma's generic include narrows
// cleanly without an explicit `Prisma.TransactionGetPayload<>`).
// ─────────────────────────────────────────────────────────────

interface TxnRow {
  id: string;
  transactionSetId: string;
  controlNumber: string;
  direction: LifecycleDirection;
  ackedGroupControl: string | null;
  ackedTxnControls: unknown;
  ackStatus: string | null;
  // Phase 8 Sprint 1 — outbound timestamps. Null on inbound rows by construction.
  generatedAt: Date | null;
  transmittedAt: Date | null;
  confirmedAt: Date | null;
  functionalGroup: {
    controlNumber: string;
    interchange: {
      senderId: string;
      receiverId: string;
      rawFile: { id: string; ingestedAt: Date; isaControlNumber: string | null; source: SourceChannel };
    };
  };
}

interface AckEntry {
  setId: string;
  control: string;
  status: string;
  /** Phase 5 — decoded AK501 status (X12 wording) if the parser captured it. */
  statusMessage: string | null;
  /** Phase 5 — structured AK3/AK4 tree under this acked transaction. */
  errors: RejectionSegmentError[];
}

function parseAckedTxnControls(raw: unknown): AckEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map((e) => ({
      setId: String(e.setId ?? ''),
      control: String(e.control ?? ''),
      status: String(e.status ?? ''),
      statusMessage: typeof e.statusMessage === 'string' ? e.statusMessage : null,
      errors: parseSegmentErrors(e.errors),
    }));
}

/** Defensive shape-check on AK3/AK4 trees coming back from JSONB. */
function parseSegmentErrors(raw: unknown): RejectionSegmentError[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map((e) => ({
      segmentTag: String(e.segmentTag ?? ''),
      segmentPosition: String(e.segmentPosition ?? ''),
      loopIdentifier: String(e.loopIdentifier ?? ''),
      syntaxErrorCode: String(e.syntaxErrorCode ?? ''),
      syntaxErrorMessage: typeof e.syntaxErrorMessage === 'string' ? e.syntaxErrorMessage : null,
      elementErrors: parseElementErrors(e.elementErrors),
    }));
}

function parseElementErrors(raw: unknown): RejectionElementError[] {
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

/**
 * Phase 5 — derive a one-line plain-English summary from an AK3/AK4 tree.
 * Prefers the first element error (most actionable) over the bare segment
 * error. Returns null when there is nothing to summarize.
 */
function summarizeErrors(errors: RejectionSegmentError[]): string | null {
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

// ─────────────────────────────────────────────────────────────
// The main service.
// ─────────────────────────────────────────────────────────────

const INCLUDE = {
  functionalGroup: { include: { interchange: { include: { rawFile: true } } } },
} as const;

const INCLUDE_WITH_SEGMENTS = {
  ...INCLUDE,
  segments: { include: { elements: true } },
} as const;

interface SegmentElementRow { index: number; value: string }
interface SegmentRow { tag: string; position: number; elements: SegmentElementRow[] }
type TxnRowWithSegments = TxnRow & { segments: SegmentRow[] };

function toDecomposed(row: TxnRowWithSegments): DecomposedTransaction {
  const segments = [...row.segments]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      tag: s.tag,
      position: s.position,
      elements: [...s.elements].sort((a, b) => a.index - b.index).map((e) => ({ index: e.index, value: e.value })),
    }));
  return {
    transactionSetId: row.transactionSetId,
    controlNumber: row.controlNumber,
    declaredSegmentCount: null,
    segmentCount: segments.length,
    segments,
  };
}

/** Pick up same-partner transactions whose `po_number` column is null but
 *  whose BAK/BIG/BCH segment still references the spine PO. */
async function stitchOrphanTransactions(
  prisma: PrismaClient,
  spine: ResolvedSpine,
  anchor: TxnRow,
  knownIds: ReadonlySet<string>,
): Promise<TxnRowWithSegments[]> {
  const senderId = anchor.functionalGroup.interchange.senderId;
  const receiverId = anchor.functionalGroup.interchange.receiverId;
  const candidates = (await prisma.transaction.findMany({
    where: {
      ...(knownIds.size > 0 ? { id: { notIn: [...knownIds] } } : {}),
      poNumber: null,
      transactionSetId: { in: [...ORPHAN_PO_SETS] },
      functionalGroup: {
        interchange: {
          OR: [
            { senderId, receiverId },
            { senderId: receiverId, receiverId: senderId },
          ],
        },
      },
    },
    include: INCLUDE_WITH_SEGMENTS,
  })) as unknown as TxnRowWithSegments[];

  const matched: TxnRowWithSegments[] = [];
  for (const row of candidates) {
    const keys = extractBusinessKeys(toDecomposed(row));
    if (keys.poNumber === spine.po) matched.push(row);
  }
  return matched;
}

export interface GetLifecycleOptions {
  /** OUR_ISA_IDS — used to resolve the trading partner from the interchange
   *  pair so we can apply their configured lifecycle flow if any. */
  ourIsaIds?: readonly string[];
}

function resolveEventDirection(
  stored: LifecycleDirection,
  senderId: string,
  receiverId: string,
  ourIsaIds: readonly string[],
): LifecycleDirection {
  if (ourIsaIds.length === 0) return stored;
  const derived = computeDirection(senderId, receiverId, ourIsaIds);
  // Prefer a freshly derived direction when the stored value was unknown
  // (common when files were parsed before ourIsaIds was configured).
  return stored === 'unknown' && derived !== 'unknown' ? derived : stored;
}

function rawFileMeta(t: TxnRow): { isaControlNumber: string | null; source: SourceChannel } {
  const rf = t.functionalGroup.interchange.rawFile;
  return { isaControlNumber: rf.isaControlNumber, source: rf.source };
}

function headerSummaryForTransaction(row: TxnRowWithSegments | TxnRow | undefined): string | null {
  if (!row) return null;
  const headerSets = new Set(['855', '856', '860', '875', '880']);
  if (!headerSets.has(row.transactionSetId)) return null;
  if (!('segments' in row) || !Array.isArray(row.segments)) return null;
  const interp = interpretTransaction(toDecomposed(row as TxnRowWithSegments));
  if (interp.type === '855') {
    const parts: string[] = [];
    if (interp.ackType) parts.push(`Ack ${interp.ackType}`);
    if (interp.totalQty) parts.push(`${interp.totalQty} units`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  if (interp.type === '856') {
    const parts: string[] = [];
    if (interp.shipmentId) parts.push(`Ship ${interp.shipmentId}`);
    if (interp.shipDate) parts.push(`Date ${interp.shipDate}`);
    if (interp.carrierRef) parts.push(interp.carrierRef);
    if (interp.totalQty) parts.push(`${interp.totalQty} units`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  if (interp.type === '860') {
    const parts: string[] = [];
    if (interp.purpose) parts.push(`Change ${interp.purpose}`);
    if (interp.originalPoNumber && interp.originalPoNumber !== interp.poNumber) {
      parts.push(`was ${interp.originalPoNumber}`);
    }
    if (interp.poDate) parts.push(`Date ${interp.poDate}`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  if (interp.type === '875') {
    const parts: string[] = [];
    if (interp.poNumber) parts.push(`PO ${interp.poNumber}`);
    if (interp.poDate) parts.push(`Date ${interp.poDate}`);
    if (interp.purpose) parts.push(`Purpose ${interp.purpose}`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  if (interp.type === '880') {
    const parts: string[] = [];
    if (interp.invoiceNumber) parts.push(`Inv ${interp.invoiceNumber}`);
    if (interp.poNumber) parts.push(`PO ${interp.poNumber}`);
    if (interp.totalAmount) parts.push(`Total ${interp.totalAmount}`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  return null;
}

/** When multiple documents share (setId, direction), stamp 1-based indexes. */
function assignInstanceIndexes(events: LifecycleEvent[]): void {
  const totals = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 'transaction') continue;
    const k = `${e.transactionSetId}::${e.direction}`;
    totals.set(k, (totals.get(k) ?? 0) + 1);
  }
  const counters = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 'transaction') continue;
    const k = `${e.transactionSetId}::${e.direction}`;
    const total = totals.get(k) ?? 1;
    if (total <= 1) {
      e.instanceIndex = null;
      continue;
    }
    const idx = (counters.get(k) ?? 0) + 1;
    counters.set(k, idx);
    e.instanceIndex = idx;
  }
}

export async function getLifecycle(
  prisma: PrismaClient,
  query: LifecycleQuery,
  options: GetLifecycleOptions = {},
): Promise<LifecycleResponse | null> {
  const spine = await resolveSpine(prisma, query);
  if (!spine) return null;
  const ourIsaIds = options.ourIsaIds ?? [];

  // All transactions sharing the PO. Includes 997s only if they happened to be
  // tagged with a PO — they normally aren't, so this stays the "originals" set.
  const poTxns = (await prisma.transaction.findMany({
    where: { poNumber: spine.po },
    include: INCLUDE_WITH_SEGMENTS,
  })) as unknown as TxnRowWithSegments[];

  if (poTxns.length === 0) return null;

  // Rows indexed by po_number miss outbound docs when the column was never
  // backfilled. Re-derive from segments for the same partner pair.
  const stitchAnchor =
    poTxns.find((t) => t.transactionSetId !== '997' && t.transactionSetId !== '999') ?? poTxns[0];
  if (stitchAnchor) {
    const known = new Set(poTxns.map((t) => t.id));
    const orphans = await stitchOrphanTransactions(prisma, spine, stitchAnchor, known);
    poTxns.push(...orphans);
  }

  const txnById = new Map(poTxns.map((t) => [t.id, t]));

  // Find 997s/999s that ack any of these PO transactions: those whose
  // ackedGroupControl matches one of the PO transactions' group controls.
  const groupControls = Array.from(new Set(poTxns.map((t) => t.functionalGroup.controlNumber)));
  const ackCandidates = (await prisma.transaction.findMany({
    where: {
      transactionSetId: { in: ['997', '999'] },
      ackedGroupControl: { in: groupControls },
    },
    include: INCLUDE,
  })) as unknown as TxnRow[];

  // For each original PO transaction, find the first ack that matches its
  // (group control + setId + controlNumber) triple.
  const ackByOriginal = new Map<string, { ackTxnId: string; entry: AckEntry }>();
  const validAcks = new Set<string>();
  // Parsed entries keyed by ack id so the 997-event loop can reuse them.
  const entriesByAck = new Map<string, AckEntry[]>();
  for (const ack of ackCandidates) {
    entriesByAck.set(ack.id, parseAckedTxnControls(ack.ackedTxnControls));
  }
  for (const original of poTxns) {
    if (original.transactionSetId === '997' || original.transactionSetId === '999') continue;
    for (const ack of ackCandidates) {
      if (ack.ackedGroupControl !== original.functionalGroup.controlNumber) continue;
      const entries = entriesByAck.get(ack.id) ?? [];
      const hit = entries.find(
        (e) => e.setId === original.transactionSetId && e.control === original.controlNumber,
      );
      if (hit) {
        if (!ackByOriginal.has(original.id)) {
          ackByOriginal.set(original.id, { ackTxnId: ack.id, entry: hit });
        }
        validAcks.add(ack.id);
      }
    }
  }

  // Build the timeline.
  const events: LifecycleEvent[] = [];
  for (const t of poTxns) {
    const isAck = t.transactionSetId === '997' || t.transactionSetId === '999';
    if (isAck) continue; // We surface 997s via the matched-acks loop below.
    const ack = ackByOriginal.get(t.id);
    const evStatus: LifecycleStatus = ack ? statusFromAk5(ack.entry.status) : 'received';
    const isRejected = evStatus === 'rejected';
    const rfMeta = rawFileMeta(t);
    events.push({
      kind: 'transaction',
      transactionSetId: t.transactionSetId,
      direction: resolveEventDirection(
        t.direction,
        t.functionalGroup.interchange.senderId,
        t.functionalGroup.interchange.receiverId,
        ourIsaIds,
      ),
      status: evStatus,
      transactionId: t.id,
      rawFileId: t.functionalGroup.interchange.rawFile.id,
      controlNumber: t.controlNumber,
      ingestedAt: t.functionalGroup.interchange.rawFile.ingestedAt.toISOString(),
      ackStatus: null,
      ackedByTransactionId: ack?.ackTxnId ?? null,
      rejectionSummary: isRejected ? summarizeErrors(ack!.entry.errors) ?? ack!.entry.statusMessage : null,
      rejectionDetails: isRejected && ack!.entry.errors.length > 0 ? ack!.entry.errors : null,
      outboundStage: deriveOutboundStage(t.generatedAt, t.transmittedAt, t.confirmedAt),
      partnerChannel: null,
      isaControlNumber: rfMeta.isaControlNumber,
      source: rfMeta.source,
      instanceIndex: null,
      headerSummary: headerSummaryForTransaction(txnById.get(t.id) ?? (t as TxnRowWithSegments)),
    });
  }
  for (const ack of ackCandidates) {
    if (!validAcks.has(ack.id)) continue;
    // The 997's own status reflects its group-level AK9 outcome (A/E/P/R).
    const status: LifecycleStatus =
      ack.ackStatus === 'R' || ack.ackStatus === 'M' ? 'rejected' : 'received';
    const entries = entriesByAck.get(ack.id) ?? [];
    const allErrors = entries.flatMap((e) => e.errors);
    const summary = status === 'rejected'
      ? summarizeErrors(allErrors) ?? (entries.find((e) => statusFromAk5(e.status) === 'rejected')?.statusMessage ?? null)
      : null;
    const ackRfMeta = rawFileMeta(ack);
    events.push({
      kind: 'transaction',
      transactionSetId: ack.transactionSetId,
      direction: resolveEventDirection(
        ack.direction,
        ack.functionalGroup.interchange.senderId,
        ack.functionalGroup.interchange.receiverId,
        ourIsaIds,
      ),
      status,
      transactionId: ack.id,
      rawFileId: ack.functionalGroup.interchange.rawFile.id,
      controlNumber: ack.controlNumber,
      ingestedAt: ack.functionalGroup.interchange.rawFile.ingestedAt.toISOString(),
      ackStatus: ack.ackStatus,
      ackedByTransactionId: null,
      rejectionSummary: summary,
      rejectionDetails: allErrors.length > 0 ? allErrors : null,
      outboundStage: deriveOutboundStage(ack.generatedAt, ack.transmittedAt, ack.confirmedAt),
      partnerChannel: null,
      isaControlNumber: ackRfMeta.isaControlNumber,
      source: ackRfMeta.source,
      instanceIndex: null,
      headerSummary: null,
    });
  }

  // Sort chronologically. Stable ISO-8601 strings sort lexically.
  events.sort((a, b) => (a.ingestedAt ?? '').localeCompare(b.ingestedAt ?? ''));
  assignInstanceIndexes(events);

  // Phase 6 Sprint 2 — resolve the partner from any of the PO transactions
  // and look for a configured flow whose entrySetId matches a set we see. If
  // we have one, it takes precedence over the shipped defaults; if not, the
  // existing default selection still runs.
  let partner: TradingPartnerRecord | null = null;
  const anchor = poTxns.find((t) => t.transactionSetId !== '997' && t.transactionSetId !== '999') ?? poTxns[0];
  if (anchor) {
    partner = await resolvePartnerByIsa(
      prisma,
      anchor.functionalGroup.interchange.senderId,
      anchor.functionalGroup.interchange.receiverId,
      ourIsaIds,
    );
  }

  const setsPresent = new Set(events.map((e) => e.transactionSetId));
  let flow: LifecycleFlow = determineFlow(setsPresent);
  let seed: readonly ExpectedDoc[] = flow === 'standard' ? STANDARD_FLOW : flow === 'grocery' ? GROCERY_FLOW : [];
  if (partner && partner.lifecycleFlows.length > 0) {
    const partnerFlow = partner.lifecycleFlows.find((f) => setsPresent.has(f.entrySetId));
    if (partnerFlow) {
      seed = partnerFlow.steps;
      // Tag flow with the partner's flow name when it's not the shipped default.
      if (partnerFlow.name === DEFAULT_STANDARD_FLOW.name) flow = 'standard';
      else if (partnerFlow.name === DEFAULT_GROCERY_FLOW.name) flow = 'grocery';
      // For custom flow names, leave the `flow` literal alone (still 'standard' /
      // 'grocery' / 'unknown' from the default selection above); the partner's
      // overridden steps drive gap detection regardless.
    }
  }

  // Count how many of each (setId, direction) the seed expects vs how many we
  // have, so a flow that expects three 997s still emits gaps if only one arrived.
  const haveCount = new Map<string, number>();
  for (const e of events) {
    const k = `${e.transactionSetId}::${e.direction}`;
    haveCount.set(k, (haveCount.get(k) ?? 0) + 1);
  }
  const wantCount = new Map<string, number>();
  for (const s of seed) {
    const k = `${s.setId}::${s.direction}`;
    wantCount.set(k, (wantCount.get(k) ?? 0) + 1);
  }
  for (const [k, want] of wantCount) {
    const have = haveCount.get(k) ?? 0;
    if (have >= want) continue;
    const [setId, direction] = k.split('::') as [string, LifecycleDirection];
    for (let i = 0; i < want - have; i++) {
      events.push({
        kind: 'gap',
        transactionSetId: setId,
        direction,
        status: 'expected_missing',
        transactionId: null,
        rawFileId: null,
        controlNumber: null,
        ingestedAt: null,
        ackStatus: null,
        ackedByTransactionId: null,
        rejectionSummary: null,
        rejectionDetails: null,
        // Gaps don't carry a stage — there's no transaction to derive from.
        outboundStage: null,
        partnerChannel: null,
        isaControlNumber: null,
        source: null,
        instanceIndex: null,
        headerSummary: null,
      });
    }
  }

  // Phase 6 Sprint 2 — overlay the partner's ack-code overrides onto the
  // rejection details so the response carries the partner-preferred wording.
  // No partner / empty overrides → pass through unchanged.
  const overrides = partner?.ackCodeOverrides;
  if (overrides) {
    for (const ev of events) {
      if (ev.rejectionDetails) {
        ev.rejectionDetails = applyAckOverrides(ev.rejectionDetails, overrides);
      }
    }
  }

  // Phase 8 Sprint 3 — stamp the partner's configured transmission channel
  // onto each outbound event. We only surface it on outbound rows so ops can
  // see at a glance how the hub transmitted; inbound rows describe the
  // partner's transport choice, which is the SAME channel here (we receive
  // on it), but the plan scopes the chip to outbound to keep the row terse.
  const partnerChannel = partner?.connectivity?.channel ?? null;
  if (partnerChannel) {
    for (const ev of events) {
      if (ev.kind === 'transaction' && ev.direction === 'outbound') {
        ev.partnerChannel = partnerChannel;
      }
    }
  }

  return { po: spine.po, enteredBy: spine.enteredBy, flow, events, partner: partnerSummary(partner) };
}

function partnerSummary(partner: TradingPartnerRecord | null): LifecycleResponse['partner'] {
  if (!partner) return null;
  return {
    id: partner.id,
    displayName: partner.displayName,
    slaCountdownEnabled: partner.slaCountdownEnabled,
    slaWindows: partner.slaWindows,
  };
}

/** Derive list-row counts from a stitched lifecycle timeline. */
export function summarizeLifecycleEvents(events: LifecycleEvent[]): {
  received: number;
  missing: number;
  rejected: number;
  hasDuplicates: boolean;
  additionalDocumentCount: number;
} {
  let received = 0;
  let missing = 0;
  let rejected = 0;
  const dupKeys = new Map<string, number>();
  for (const e of events) {
    if (e.kind === 'gap') {
      missing += 1;
      continue;
    }
    if (e.status === 'rejected') rejected += 1;
    else received += 1;
    const k = `${e.transactionSetId}::${e.direction}`;
    dupKeys.set(k, (dupKeys.get(k) ?? 0) + 1);
  }
  let additionalDocumentCount = 0;
  let hasDuplicates = false;
  for (const n of dupKeys.values()) {
    if (n > 1) {
      hasDuplicates = true;
      additionalDocumentCount += n - 1;
    }
  }
  return { received, missing, rejected, hasDuplicates, additionalDocumentCount };
}
