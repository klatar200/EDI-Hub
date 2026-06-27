/**
 * PS-9 F34 — format a lifecycle conversation for TXT / CSV / PDF export.
 */
import type { LifecycleEvent, LifecycleResponse } from '@edi/shared';

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function lifecycleToTxt(lc: LifecycleResponse): string {
  const lines: string[] = [
    `Lifecycle: ${lc.po}`,
    `Partner: ${lc.partner?.displayName ?? '—'}`,
    `Flow: ${lc.flow}`,
    `Entered by: ${lc.enteredBy.kind} ${lc.enteredBy.value}`,
    '',
    'Documents (chronological):',
    '',
  ];
  for (const e of lc.events) {
    if (e.kind === 'gap') {
      lines.push(
        `  [${e.transactionSetId}] ${e.direction} · EXPECTED MISSING`,
      );
      continue;
    }
    const dup = e.instanceIndex !== null ? ` · copy ${e.instanceIndex}` : '';
    lines.push(
      `  [${e.transactionSetId}] ${e.direction} · ${e.status}${dup}`,
      `    ingested: ${e.ingestedAt ?? '—'}`,
      `    control: ${e.controlNumber ?? '—'} · ISA: ${e.isaControlNumber ?? '—'}`,
      `    source: ${e.source ?? '—'} · txn: ${e.transactionId ?? '—'}`,
      '',
    );
  }
  return lines.join('\n');
}

export function lifecycleToCsv(lc: LifecycleResponse): string {
  const headers = [
    'po',
    'setId',
    'direction',
    'status',
    'kind',
    'controlNumber',
    'isaControlNumber',
    'ingestedAt',
    'transactionId',
    'rawFileId',
    'instanceIndex',
    'source',
  ];
  const rows = lc.events.map((e) =>
    [
      csvEscape(lc.po),
      csvEscape(e.transactionSetId),
      csvEscape(e.direction),
      csvEscape(e.status),
      csvEscape(e.kind),
      csvEscape(e.controlNumber ?? ''),
      csvEscape(e.isaControlNumber ?? ''),
      csvEscape(e.ingestedAt ?? ''),
      csvEscape(e.transactionId ?? ''),
      csvEscape(e.rawFileId ?? ''),
      e.instanceIndex !== null ? String(e.instanceIndex) : '',
      csvEscape(e.source ?? ''),
    ].join(','),
  );
  return [headers.join(','), ...rows].join('\n');
}

export function lifecycleToPdf(lc: LifecycleResponse): Buffer {
  const text = lifecycleToTxt(lc).slice(0, 4000).replace(/[()\\]/g, ' ');
  const pdfBody = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R>>endobj\n4 0 obj<</Length ${text.length + 50}>>stream\nBT /F1 10 Tf 50 750 Td (${text}) Tj ET\nendstream endobj\nxref\n0 5\ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n0\n%%EOF`;
  return Buffer.from(pdfBody);
}

export function groupDuplicateEvents(events: LifecycleEvent[]): LifecycleEvent[][] {
  const groups = new Map<string, LifecycleEvent[]>();
  for (const e of events) {
    if (e.kind !== 'transaction') continue;
    const key = `${e.transactionSetId}::${e.direction}`;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
