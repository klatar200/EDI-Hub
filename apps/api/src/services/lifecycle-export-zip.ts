/**
 * PS-11 F57 / PB-6 F58 — build a ZIP of lifecycle exports (txt/csv/pdf + optional raw EDI).
 */
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import type { Archiver } from 'archiver';
import type { PrismaClient } from '@prisma/client';
import type { LifecycleExportFormat, LifecycleResponse } from '@edi/shared';
import type { StorageAdapter } from '../storage/interface.js';
import { getLifecycle } from './lifecycle.js';
import { lifecycleToCsv, lifecycleToPdf, lifecycleToTxt } from './lifecycle-export-format.js';

const require = createRequire(import.meta.url);
const archiver = require('archiver') as (format: 'zip', options?: { zlib?: { level: number } }) => Archiver;

function safePoName(po: string): string {
  return po.replace(/[^\w.-]+/g, '_');
}

function safeFilePart(value: string): string {
  return value.replace(/[^\w.-]+/g, '_') || 'file';
}

function appendLifecycleFormats(
  archive: Archiver,
  po: string,
  formats: LifecycleExportFormat[],
  lc: LifecycleResponse | null,
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

/** Collect unique raw files referenced by lifecycle events. */
export function rawFileRefsFromLifecycle(lc: LifecycleResponse): Array<{
  rawFileId: string;
  setId: string;
  controlNumber: string | null;
}> {
  const seen = new Set<string>();
  const refs: Array<{ rawFileId: string; setId: string; controlNumber: string | null }> = [];
  for (const e of lc.events) {
    if (e.kind !== 'transaction' || !e.rawFileId || seen.has(e.rawFileId)) continue;
    seen.add(e.rawFileId);
    refs.push({
      rawFileId: e.rawFileId,
      setId: e.transactionSetId,
      controlNumber: e.controlNumber,
    });
  }
  return refs;
}

export async function appendRawEdiToArchive(
  archive: Archiver,
  po: string,
  lc: LifecycleResponse | null,
  prisma: PrismaClient,
  storage: StorageAdapter,
): Promise<void> {
  if (!lc) return;
  const dir = safePoName(po);
  const refs = rawFileRefsFromLifecycle(lc);
  for (const ref of refs) {
    const row = await prisma.rawFile.findUnique({
      where: { id: ref.rawFileId },
      select: { s3Key: true },
    });
    if (!row?.s3Key) continue;
    const bytes = await storage.download(row.s3Key);
    const name = `${dir}/raw/${safeFilePart(ref.setId)}-${safeFilePart(ref.controlNumber ?? ref.rawFileId)}.edi`;
    archive.append(bytes, { name });
  }
}

export interface BuildLifecycleExportZipOptions {
  prisma: PrismaClient;
  pos: string[];
  ourIsaIds: string[];
  formats: LifecycleExportFormat[];
  includeRaw?: boolean;
  storage?: StorageAdapter;
}

export async function buildLifecycleExportZip(
  options: BuildLifecycleExportZipOptions,
): Promise<Buffer> {
  const { prisma, pos, ourIsaIds, formats, includeRaw, storage } = options;
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
    if (includeRaw && storage && lc) {
      await appendRawEdiToArchive(archive, po, lc, prisma, storage);
    }
  }

  await archive.finalize();
  return done;
}
