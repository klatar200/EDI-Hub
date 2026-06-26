/**
 * Recompute transaction.direction from interchange sender/receiver + tenant.ourIsaIds.
 *
 * Does not read raw file bytes — safe to run against a desktop install whose
 * dev `.env` still points at Minio/S3.
 *
 * Desktop (EDI Hub running):
 *   npm run backfill-direction --workspace=@edi/api -- --desktop
 *
 * After setting ourIsaIds:
 *   npm run set-our-isa-ids --workspace=@edi/api -- --desktop 7085892400
 *   npm run backfill-direction --workspace=@edi/api -- --desktop
 */
import { getPrisma, disconnectPrisma, tenantContext, PILOT_TENANT_ID } from '@edi/db';
import { computeDirection } from '../services/parsing.js';
import { applyDesktopScriptEnv } from './desktop-script-env.js';

applyDesktopScriptEnv(process.argv);

async function main(): Promise<void> {
  const prisma = getPrisma();

  await tenantContext.run({ tenantId: PILOT_TENANT_ID }, async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: PILOT_TENANT_ID },
      select: { ourIsaIds: true },
    });
    const ourIsaIds = tenant?.ourIsaIds ?? [];
    if (ourIsaIds.length === 0) {
      console.error(
        'tenant.ourIsaIds is empty. Set it first:\n' +
          '  npm run set-our-isa-ids --workspace=@edi/api -- --desktop 7085892400',
      );
      process.exit(2);
    }

    const txns = await prisma.transaction.findMany({
      select: {
        id: true,
        direction: true,
        transactionSetId: true,
        functionalGroup: {
          select: {
            interchange: { select: { senderId: true, receiverId: true } },
          },
        },
      },
    });

    let updated = 0;
    for (const t of txns) {
      const { senderId, receiverId } = t.functionalGroup.interchange;
      const next = computeDirection(senderId, receiverId, ourIsaIds);
      if (next === t.direction) continue;
      await prisma.transaction.update({ where: { id: t.id }, data: { direction: next } });
      updated += 1;
      console.log(`  ${t.transactionSetId} ${t.id.slice(0, 8)}… ${t.direction} → ${next}`);
    }

    console.log(
      `Direction backfill complete: ${updated} updated, ${txns.length - updated} unchanged ` +
        `(ourIsaIds=[${ourIsaIds.join(', ')}]).`,
    );
  });

  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error('backfill-direction failed:', err);
  await disconnectPrisma();
  process.exit(1);
});
