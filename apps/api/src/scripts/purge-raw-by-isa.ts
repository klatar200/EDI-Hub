/**
 * Delete ingested raw files (and cascaded parse tree) by ISA control number.
 *
 * Use when you need to re-drop the same X12 interchange — dedup keys on ISA13.
 *
 * Desktop (EDI Hub running, Postgres on 5433):
 *   $env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5433/edihub"
 *   npm run purge-raw-by-isa --workspace=@edi/api -- --desktop --us-foods-group-1 --yes
 *
 * Dev / docker-compose:
 *   npm run purge-raw-by-isa --workspace=@edi/api -- 000059901 000059902 --yes
 */
import { getPrisma, disconnectPrisma, tenantContext, PILOT_TENANT_ID } from '@edi/db';
import { applyDesktopScriptEnv } from './desktop-script-env.js';

applyDesktopScriptEnv(process.argv);

const US_FOODS_GROUP_1_ISA = ['000059901', '000059902', '000059903'] as const;

function usage(): never {
  console.error(`Usage:
  npm run purge-raw-by-isa --workspace=@edi/api -- [--us-foods-group-1 | ISA13 ...] [--yes]

  --us-foods-group-1   Delete synthetic US Foods group-1 lifecycles (${US_FOODS_GROUP_1_ISA.join(', ')})
  --yes                Required to execute (otherwise dry-run preview only)
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const isaArgs = args.filter((a) => !a.startsWith('--'));

  let isaList: string[];
  if (args.includes('--us-foods-group-1')) {
    isaList = [...US_FOODS_GROUP_1_ISA];
  } else if (isaArgs.length > 0) {
    isaList = isaArgs;
  } else {
    usage();
  }

  const prisma = getPrisma();

  await tenantContext.run({ tenantId: PILOT_TENANT_ID }, async () => {
    const rows = await prisma.rawFile.findMany({
      where: { isaControlNumber: { in: isaList } },
      select: { id: true, isaControlNumber: true, status: true, ingestedAt: true, s3Key: true },
      orderBy: { ingestedAt: 'asc' },
    });

    if (rows.length === 0) {
      console.log('No raw files matched. Nothing to delete.');
      console.log(`Looked for ISA control numbers: ${isaList.join(', ')}`);
      return;
    }

    console.log(`Matched ${rows.length} raw file(s):`);
    for (const r of rows) {
      console.log(
        `  ${r.isaControlNumber ?? '?'}  status=${r.status}  ingested=${r.ingestedAt.toISOString()}  id=${r.id}`,
      );
    }

    if (!yes) {
      console.log('\nDry run only. Re-run with --yes to delete (parsed tree cascades).');
      return;
    }

    const result = await prisma.rawFile.deleteMany({
      where: { isaControlNumber: { in: isaList } },
    });
    console.log(`\nDeleted ${result.count} raw file(s). You can re-drop the same EDI files now.`);
  });

  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error('purge-raw-by-isa failed:', err);
  await disconnectPrisma();
  process.exit(1);
});
