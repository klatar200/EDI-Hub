/**
 * PS-11 F57 — build a ZIP of lifecycle exports (txt/csv/pdf per PO).
 */
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import type { Archiver } from 'archiver';
import type { PrismaClient } from '@prisma/client';
import type { LifecycleExportFormat } from '@edi/shared';
import { getLifecycle } from './lifecycle.js';
import { lifecycleToCsv, lifecycleToPdf, lifecycleToTxt } from './lifecycle-export-format.js';

const require = createRequire(import.meta.url);
const archiver = require('archiver') as (format: 'zip', options?: { zlib?: { level: number } }) => Archiver;

function safePoName(po: string): string {
  return po.replace(/[^\w.-]+/g, '_');
}

function appendLifecycleFormats(
  archive: Archiver,
  po: string,
  formats: LifecycleExportFormat[],
  lc: Awaited<ReturnType<typeof getLifecycle>>,
): void {
  if (!lc) return;
  const dir = safePoName(po);
  for (const format of formats) {
    if (format === 'txt') {
      archive.append(lifecycleToTxt(lc), { name: `${dir}/lifecycle.txt` });
    } else if (format === 'csv') {
      archive.append(lifecycleToCsv(lc), { name: `${dir}/lifecycle.csv` });
    } else if (format === 'pdf') {
      archive.append(lifecycleToPdf(lc), { name: `${dir}/lifecycle.pdf` });
    }
  }
}

export async function buildLifecycleExportZip(
  prisma: PrismaClient,
  pos: string[],
  ourIsaIds: string[],
  formats: LifecycleExportFormat[],
): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const done = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    archive.on('error', reject);
    archive.pipe(stream);
  });

  for (const po of pos) {
    const lc = await getLifecycle(prisma, { po }, { ourIsaIds });
    appendLifecycleFormats(archive, po, formats, lc);
  }

  await archive.finalize();
  return done;
}
