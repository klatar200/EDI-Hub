/**
 * Desktop operator helper — set tenant ourIsaIds for inbound/outbound classification.
 *
 *   npm run set-our-isa-ids --workspace=@edi/api -- 7085892400
 *   npm run set-our-isa-ids --workspace=@edi/api -- 7085892400,SECOND_ID
 *
 * Desktop:
 *   npm run set-our-isa-ids --workspace=@edi/api -- --desktop 7085892400
 *
 * After setting, re-open lifecycle views (direction is re-derived at read time).
 * To fix stored transaction.direction for metrics/search, also run:
 *   npm run backfill --workspace=@edi/api -- --reparse-parsed
 */
import { getPrisma, disconnectPrisma, tenantContext, PILOT_TENANT_ID } from '@edi/db';
import { applyDesktopScriptEnv } from './desktop-script-env.js';

applyDesktopScriptEnv(process.argv);

function parseIds(argv: string[]): string[] {
  const raw = argv
    .slice(2)
    .filter((a) => a !== '--desktop')
    .join(',')
    .trim();
  if (!raw) {
    console.error('Usage: set-our-isa-ids <ISA_ID>[,<ISA_ID>...]');
    process.exit(2);
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main(): Promise<void> {
  const ids = parseIds(process.argv);
  const prisma = getPrisma();

  await tenantContext.bypass(async () => {
    const existing = await prisma.tenant.findUnique({
      where: { id: PILOT_TENANT_ID },
      select: { ourIsaIds: true },
    });
    if (!existing) {
      console.error(`Pilot tenant ${PILOT_TENANT_ID} not found.`);
      process.exit(2);
    }
    const updated = await prisma.tenant.update({
      where: { id: PILOT_TENANT_ID },
      data: { ourIsaIds: ids },
    });
    console.log(
      `ourIsaIds updated: [${existing.ourIsaIds.join(', ')}] → [${updated.ourIsaIds.join(', ')}]`,
    );
    console.log('Lifecycle views will classify inbound/outbound immediately.');
    console.log('Run backfill --reparse-parsed to update stored transaction rows.');
  });

  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error('set-our-isa-ids failed:', err);
  await disconnectPrisma();
  process.exit(1);
});
