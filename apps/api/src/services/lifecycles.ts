/**
 * PS-1 — paginated PO/conversation list for the lifecycle-first homepage.
 */
import type { PrismaClient } from '@prisma/client';
import type { LifecycleListFilters, LifecycleSummary } from '@edi/shared';
import { getLifecycle, summarizeLifecycleEvents } from './lifecycle.js';

/** Build human-readable expected-document warnings from gap events. */
export function expectedWarningsFromEvents(
  events: Array<{ kind: string; transactionSetId: string; direction: string; status: string }>,
): string[] {
  return events
    .filter((e) => e.kind === 'gap' && e.status === 'expected_missing')
    .map((e) => `${e.transactionSetId} (${e.direction}) expected — not yet received`);
}

interface PoRow {
  po: string;
  started_at: Date;
  last_activity_at: Date;
}

export interface ListLifecyclesOptions {
  ourIsaIds: string[];
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

  const conditions: string[] = ['t.po_number IS NOT NULL', 't.tenant_id = $1::uuid'];
  const params: unknown[] = [await tenantIdFromContext()];
  let paramIdx = 2;

  if (filters.from) {
    conditions.push(`rf.ingested_at >= $${paramIdx}::timestamptz`);
    params.push(new Date(filters.from));
    paramIdx += 1;
  }
  if (filters.to) {
    conditions.push(`rf.ingested_at <= $${paramIdx}::timestamptz`);
    params.push(new Date(filters.to));
    paramIdx += 1;
  }

  const whereSql = conditions.join(' AND ');

  const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(DISTINCT t.po_number)::bigint AS count
     FROM transactions t
     INNER JOIN functional_groups fg ON t.functional_group_id = fg.id
     INNER JOIN interchanges i ON fg.interchange_id = i.id
     INNER JOIN raw_files rf ON i.raw_file_id = rf.id
     WHERE ${whereSql}`,
    ...params,
  );
  const total = Number(countRows[0]?.count ?? 0);

  const poRows = await prisma.$queryRawUnsafe<PoRow[]>(
    `SELECT t.po_number AS po,
            MIN(rf.ingested_at) AS started_at,
            MAX(rf.ingested_at) AS last_activity_at
     FROM transactions t
     INNER JOIN functional_groups fg ON t.functional_group_id = fg.id
     INNER JOIN interchanges i ON fg.interchange_id = i.id
     INNER JOIN raw_files rf ON i.raw_file_id = rf.id
     WHERE ${whereSql}
     GROUP BY t.po_number
     ORDER BY MIN(rf.ingested_at) DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    ...params,
    pageSize,
    offset,
  );

  const activeAlerts = await prisma.alert.findMany({
    where: { status: 'active' },
    select: { sourceRef: true },
  });
  const alertsByPo = new Map<string, number>();
  for (const a of activeAlerts) {
    const ref = a.sourceRef as Record<string, unknown>;
    const po = typeof ref.poNumber === 'string' ? ref.poNumber : null;
    if (po) alertsByPo.set(po, (alertsByPo.get(po) ?? 0) + 1);
  }

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

  const summaries: LifecycleSummary[] = [];
  for (const row of poRows) {
    const lc = await getLifecycle(prisma, { po: row.po }, options);
    if (!lc) continue;

    const counts = summarizeLifecycleEvents(lc.events);
    const openAlertCount = alertsByPo.get(row.po) ?? 0;
    const hasParseError = parseErrorSet.has(row.po);

    if (filters.hasAlerts === true && openAlertCount === 0) continue;
    if (filters.hasParseError === true && !hasParseError) continue;
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
    });
  }

  return { items: summaries, page, pageSize, total };
}

/** Tenant id from Prisma extension context — caller must run inside tenantContext. */
async function tenantIdFromContext(): Promise<string> {
  const { tenantContext } = await import('@edi/db');
  return tenantContext.requireTenantId();
}
