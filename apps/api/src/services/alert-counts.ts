/**
 * Build a map of PO number → open active alert count for the current tenant.
 */
import type { PrismaClient } from '@prisma/client';

export async function openAlertCountByPo(prisma: PrismaClient): Promise<Map<string, number>> {
  const activeAlerts = await prisma.alert.findMany({
    where: { status: 'active' },
    select: { sourceRef: true },
    take: 5_000,
  });
  const alertsByPo = new Map<string, number>();
  for (const a of activeAlerts) {
    const ref = a.sourceRef as Record<string, unknown>;
    const po = typeof ref.poNumber === 'string' ? ref.poNumber : null;
    if (po) alertsByPo.set(po, (alertsByPo.get(po) ?? 0) + 1);
  }
  return alertsByPo;
}
