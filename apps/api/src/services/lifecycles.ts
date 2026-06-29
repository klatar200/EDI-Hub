/**
 * PS-1 — paginated PO/conversation list for the lifecycle-first homepage.
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { LifecycleListFilters, LifecycleSummary } from '@edi/shared';
import { getLifecycle, summarizeLifecycleEvents } from './lifecycle.js';
import { computeSlaSummary, shouldShowSlaCountdown } from './sla-summary.js';
import { openAlertCountByPo } from './alert-counts.js';

/** Build human-readable expected-document warnings from gap events. */
export function expectedWarningsFromEvents(
  events: Array<{ kind: string; transactionSetId: string; direction: string; status: string }>,
): string[] {
  return events
    .filter((e) => e.kind === 'gap' && e.status === 'expected_missing')
    .map((e) => `${e.transactionSetId} (${e.direction}) expected — not yet received`);
}

/** A PO "needs attention" when something is wrong or outstanding: an expected
 *  document is still missing (a gap), a document was rejected, an alert is
 *  open, or a file failed to parse. Drives the triage filter on the list. */
export function summaryNeedsAttention(s: {
  missing: number;
  rejected: number;
  openAlertCount: number;
  hasParseError: boolean;
}): boolean {
  return s.missing > 0 || s.rejected > 0 || s.openAlertCount > 0 || s.hasParseError;
}

interface PoRow {
  po: string;
  started_at: Date;
  last_activity_at: Date;
}

export interface ListLifecyclesOptions {
  ourIsaIds: string[];
  globalSlaCountdownEnabled?: boolean;
}

export interface ListLifecyclesResult {
  items: LifecycleSummary[];
  page: number;
  pageSize: number;
  total: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export async function listLifecycles(
  prisma: PrismaClient,
  filters: LifecycleListFilters,
  options: ListLifecyclesOptions,
): Promise<ListLifecyclesResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const sortDir = filters.sort === 'startedAt:asc' ? 'ASC' : 'DESC';

  const tenantId = await tenantIdFromContext();
  const conditions: Prisma.Sql[] = [
    Prisma.sql`t.po_number IS NOT NULL`,
    Prisma.sql`t.tenant_id = ${tenantId}::uuid`,
  ];

  if (filters.from) {
    conditions.push(Prisma.sql`rf.ingested_at >= ${new Date(filters.from)}::timestamptz`);
  }
  if (filters.to) {
    conditions.push(Prisma.sql`rf.ingested_at <= ${new Date(filters.to)}::timestamptz`);
  }
  if (filters.pos && filters.pos.length > 0) {
    conditions.push(Prisma.sql`t.po_number = ANY(${filters.pos}::text[])`);
  }

  const whereSql = Prisma.join(conditions, ' AND ');
  const orderSql =
    sortDir === 'ASC'
      ? Prisma.sql`MIN(rf.ingested_at) ASC`
      : Prisma.sql`MIN(rf.ingested_at) DESC`;

  const countRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT t.po_number)::bigint AS count
    FROM transactions t
    INNER JOIN functional_groups fg ON t.functional_group_id = fg.id
    INNER JOIN interchanges i ON fg.interchange_id = i.id
    INNER JOIN raw_files rf ON i.raw_file_id = rf.id
    WHERE ${whereSql}
  `;
  const total = Number(countRows[0]?.count ?? 0);

  const poRows = await prisma.$queryRaw<PoRow[]>`
    SELECT t.po_number AS po,
           MIN(rf.ingested_at) AS started_at,
           MAX(rf.ingested_at) AS last_activity_at
    FROM transactions t
    INNER JOIN functional_groups fg ON t.functional_group_id = fg.id
    INNER JOIN interchanges i ON fg.interchange_id = i.id
    INNER JOIN raw_files rf ON i.raw_file_id = rf.id
    WHERE ${whereSql}
    GROUP BY t.po_number
    ORDER BY ${orderSql}
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const alertsByPo = await openAlertCountByPo(prisma);

  const parseErrorPos = await prisma.transaction.findMany({
    where: {
      poNumber: { in: poRows.map((r) => r.po) },
      functionalGroup: {
        interchange: {
          rawFile: { status: { in: ['PARSE_ERROR', 'FAILED'] } },
        },
      },
    },
    select: { poNumber: true },
    distinct: ['poNumber'],
  });
  const parseErrorSet = new Set(parseErrorPos.map((r) => r.poNumber).filter(Boolean) as string[]);

  const globalSlaEnabled = options.globalSlaCountdownEnabled ?? false;

  const summaries: LifecycleSummary[] = [];
  for (const row of poRows) {
    const lc = await getLifecycle(prisma, { po: row.po }, options);
    if (!lc) continue;

    const counts = summarizeLifecycleEvents(lc.events);
    const openAlertCount = alertsByPo.get(row.po) ?? 0;
    const hasParseError = parseErrorSet.has(row.po);

    if (filters.hasAlerts === true && openAlertCount === 0) continue;
    if (filters.hasParseError === true && !hasParseError) continue;
    if (
      filters.needsAttention === true &&
      !summaryNeedsAttention({
        missing: counts.missing,
        rejected: counts.rejected,
        openAlertCount,
        hasParseError,
      })
    ) {
      continue;
    }
    if (filters.flow && lc.flow !== filters.flow) continue;
    if (filters.partnerId && lc.partner?.id !== filters.partnerId) continue;
    if (filters.setId) {
      const hasSet = lc.events.some(
        (e) =>
          e.kind === 'transaction' &&
          e.transactionSetId === filters.setId &&
          (!filters.setDirection || e.direction === filters.setDirection),
      );
      if (!hasSet) continue;
    }

    const expectedWarnings = expectedWarningsFromEvents(lc.events);

    let slaSummary: LifecycleSummary['slaSummary'] = null;
    if (
      lc.partner &&
      shouldShowSlaCountdown(globalSlaEnabled, lc.partner.slaCountdownEnabled) &&
      lc.partner.slaWindows.length > 0
    ) {
      slaSummary = computeSlaSummary(lc.events, lc.partner.slaWindows);
    }

    summaries.push({
      po: row.po,
      partnerId: lc.partner?.id ?? null,
      partnerDisplayName: lc.partner?.displayName ?? null,
      flow: lc.flow,
      startedAt: row.started_at.toISOString(),
      lastActivityAt: row.last_activity_at.toISOString(),
      received: counts.received,
      missing: counts.missing,
      rejected: counts.rejected,
      openAlertCount,
      hasParseError,
      hasDuplicates: counts.hasDuplicates,
      additionalDocumentCount: counts.additionalDocumentCount,
      expectedWarnings,
      slaSummary,
      dueDate: lc.dueDate,
    });
  }

  return { items: summaries, page, pageSize, total };
}

/** Tenant id from Prisma extension context — caller must run inside tenantContext. */
async function tenantIdFromContext(): Promise<string> {
  const { tenantContext } = await import('@edi/db');
  return tenantContext.requireTenantId();
}
