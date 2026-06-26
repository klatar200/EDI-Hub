#!/usr/bin/env node
/**
 * Generate synthetic X12 test files under Test Files/.
 * Run: node scripts/generate-test-edi.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decomposeInterchange, extractBusinessKeys } from '@edi/edi-parser';
import { PARTNER_LIFECYCLES } from './partner-edi-templates.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outRoot = join(here, '..', 'Test Files');

const SENDER = 'VENDOR01';
const RECEIVER = 'EDIHUB';

function isa(isa13, { sender = SENDER, receiver = RECEIVER, date = '260625', time = '1200' } = {}) {
  const e = '*';
  return [
    'ISA', '00', ' '.repeat(10), '00', ' '.repeat(10), 'ZZ', sender.padEnd(15),
    'ZZ', receiver.padEnd(15), date, time, 'U', '00401', isa13, '0', 'P',
  ].join(e) + e + ':' + '~';
}

function interchange(isa13, gs, body, opts) {
  return isa(isa13, opts) + gs + body + '~GE*1*1~IEA*1*' + isa13 + '~';
}

function txn850(po, isa13, lines = 2) {
  const po1 =
    lines >= 1 ? 'PO1*1*10*EA*25.00**VP*SKU-10001~' : '';
  const po1b =
    lines >= 2 ? 'PO1*2*5*CA*40.00**VP*SKU-10002~' : '';
  const segCount = 4 + lines;
  const body = [
    'ST*850*0001~',
    `BEG*00*SA*${po}**20260625~`,
    'REF*DP*STORE-01~',
    'DTM*002*20260701~',
    'N1*ST*MAIN WAREHOUSE*92*WH01~',
    po1,
    po1b,
    `CTT*${lines}~`,
    `SE*${segCount}*0001~`,
  ]
    .filter(Boolean)
    .join('');
  return interchange(
    isa13,
    'GS*PO*' + SENDER + '*' + RECEIVER + '*20260625*1200*1*X*004010~',
    body,
  );
}

function txn855(po, isa13, ackType = 'AC') {
  const body = [
    'ST*855*0001~',
    `BAK*00*${ackType}*${po}*20260626~`,
    'PO1*1*10*EA*25.00**VP*SKU-10001~',
    'PO1*2*5*CA*40.00**VP*SKU-10002~',
    'SE*5*0001~',
  ].join('');
  return interchange(
    isa13,
    'GS*PR*' + SENDER + '*' + RECEIVER + '*20260626*1200*1*X*004010~',
    body,
  );
}

function txn856(po, isa13, shipmentId) {
  const body = [
    'ST*856*0001~',
    `BSN*00*${shipmentId}*20260627*1400~`,
    'HL*1**S~',
    `PRF*${po}~`,
    'SE*5*0001~',
  ].join('');
  return interchange(
    isa13,
    'GS*SH*' + SENDER + '*' + RECEIVER + '*20260627*1400*1*X*004010~',
    body,
  );
}

function txn810(po, isa13, invoiceNo) {
  const body = [
    'ST*810*0001~',
    `BIG*20260628*${invoiceNo}*20260625*${po}~`,
    'IT1*1*10*EA*25.00**VP*SKU-10001~',
    'IT1*2*5*CA*40.00**VP*SKU-10002~',
    'TDS*45000~',
    'CTT*2~',
    'SE*7*0001~',
  ].join('');
  return interchange(
    isa13,
    'GS*IN*' + SENDER + '*' + RECEIVER + '*20260628*1200*1*X*004010~',
    body,
  );
}

function txn997Accept(isa13, groupControl = '1') {
  const body = [
    'ST*997*0001~',
    `AK1*PO*${groupControl}~`,
    'AK2*850*0001~',
    'AK5*A~',
    'AK9*A*1*1*1~',
    'SE*6*0001~',
  ].join('');
  return interchange(
    isa13,
    'GS*FA*' + RECEIVER + '*' + SENDER + '*20260625*1300*1*X*004010~',
    body,
    { sender: RECEIVER, receiver: SENDER },
  );
}

function txn997Reject(isa13) {
  const body = [
    'ST*997*0001~',
    'AK1*PO*1~',
    'AK2*850*0001~',
    'AK3*BEG*2**8~',
    'AK4*3*353*1*~',
    'AK5*R~',
    'AK9*R*1*1*0~',
    'SE*8*0001~',
  ].join('');
  return interchange(
    isa13,
    'GS*FA*' + RECEIVER + '*' + SENDER + '*20260625*1300*1*X*004010~',
    body,
    { sender: RECEIVER, receiver: SENDER },
  );
}

function txn860(po, isa13) {
  const body = [
    'ST*860*0001~',
    `BCH*04*SA*${po}**20260629**${po}*1~`,
    'PO1*1*15*EA*25.00**VP*SKU-10001~',
    'SE*4*0001~',
  ].join('');
  return interchange(
    isa13,
    'GS*PC*' + SENDER + '*' + RECEIVER + '*20260629*1200*1*X*004010~',
    body,
  );
}

function txn875(po, isa13) {
  const body = ['ST*875*0001~', `BPO*00*${po}*20260625~`, 'SE*3*0001~'].join('');
  return interchange(
    isa13,
    'GS*SG*' + SENDER + '*' + RECEIVER + '*20260625*1200*1*X*004010~',
    body,
  );
}

function txn880(po, isa13, invoiceNo) {
  const body = [
    'ST*880*0001~',
    `BIG*20260630*${invoiceNo}*20260625*${po}~`,
    'TDS*123450~',
    'SE*4*0001~',
  ].join('');
  return interchange(
    isa13,
    'GS*GP*' + SENDER + '*' + RECEIVER + '*20260630*1200*1*X*004010~',
    body,
  );
}

function batched850810(isa13) {
  const t1 = [
    'ST*850*0001~',
    'BEG*00*SA*PO-30001**20260625~',
    'PO1*1*2*EA*10.00**VP*SKU-A~',
    'SE*4*0001~',
  ].join('');
  const t2 = [
    'ST*810*0002~',
    'BIG*20260628*INV-30001*20260625*PO-30001~',
    'IT1*1*2*EA*10.00**VP*SKU-A~',
    'TDS*2000~',
    'SE*5*0002~',
  ].join('');
  return (
    isa(isa13) +
    'GS*PO*' +
    SENDER +
    '*' +
    RECEIVER +
    '*20260625*1200*1*X*004010~' +
    t1 +
    'GE*1*1~' +
    'GS*IN*' +
    SENDER +
    '*' +
    RECEIVER +
    '*20260628*1200*2*X*004010~' +
    t2 +
    'GE*1*2~' +
    'IEA*2*' +
    isa13 +
    '~'
  );
}

function lineWrapped850(po, isa13) {
  const segments = [
    'ST*850*0001',
    `BEG*00*SA*${po}**20260625`,
    'PO1*1*1*EA*9.99**VP*SKU-WRAP',
    'SE*4*0001',
  ];
  const body = segments.join('~\r\n') + '~\r\n';
  return interchange(
    isa13,
    'GS*PO*' + SENDER + '*' + RECEIVER + '*20260625*1200*1*X*004010~',
    body,
  );
}

/** @type {{ rel: string, content: string, note: string }[]} */
const files = [
  // Lifecycle PO-10001 — full order-to-cash
  { rel: 'lifecycles/PO-10001/01_850_purchase_order.edi', content: txn850('PO-10001', '100010001'), note: 'Purchase order — start here' },
  { rel: 'lifecycles/PO-10001/02_855_acknowledgment.edi', content: txn855('PO-10001', '100010002', 'AC'), note: 'PO ack — accepted' },
  { rel: 'lifecycles/PO-10001/03_856_ship_notice.edi', content: txn856('PO-10001', '100010003', 'SHIP-10001'), note: 'ASN / ship notice' },
  { rel: 'lifecycles/PO-10001/04_810_invoice.edi', content: txn810('PO-10001', '100010004', 'INV-10001'), note: 'Invoice' },
  { rel: 'lifecycles/PO-10001/05_997_functional_ack.edi', content: txn997Accept('100010005'), note: '997 accepting the 850 (optional)' },

  // Lifecycle PO-10002 — rejected acknowledgment path
  { rel: 'lifecycles/PO-10002/01_850_purchase_order.edi', content: txn850('PO-10002', '100020001', 1), note: 'Single-line PO' },
  { rel: 'lifecycles/PO-10002/02_855_rejected_ack.edi', content: txn855('PO-10002', '100020002', 'RJ'), note: 'PO ack — rejected (RJ)' },
  { rel: 'lifecycles/PO-10002/03_997_reject_detail.edi', content: txn997Reject('100020003'), note: '997 with AK3/AK4 errors' },

  // Lifecycle PO-10003 — grocery sets
  { rel: 'lifecycles/PO-10003/01_875_grocery_po.edi', content: txn875('PO-10003', '100030001'), note: 'Grocery PO (875)' },
  { rel: 'lifecycles/PO-10003/02_880_grocery_invoice.edi', content: txn880('PO-10003', '100030002', 'INV-G-10003'), note: 'Grocery invoice (880)' },

  // Lifecycle PO-10004 — PO change
  { rel: 'lifecycles/PO-10004/01_850_purchase_order.edi', content: txn850('PO-10004', '100040001'), note: 'Original PO' },
  { rel: 'lifecycles/PO-10004/02_860_po_change.edi', content: txn860('PO-10004', '100040002'), note: 'PO change — qty bump on line 1' },

  // Second vendor lifecycle
  { rel: 'lifecycles/PO-20001/01_850_purchase_order.edi', content: txn850('PO-20001', '200010001'), note: 'Second vendor PO (same IDs, different PO#)' },
  { rel: 'lifecycles/PO-20001/02_810_invoice.edi', content: txn810('PO-20001', '200010002', 'INV-20001'), note: 'Invoice without 855/856' },

  // Singles — quick smoke tests
  { rel: 'singles/850_minimal.edi', content: txn850('PO-SMOKE-01', '900010001', 1), note: 'One-line 850' },
  { rel: 'singles/855_minimal.edi', content: txn855('PO-SMOKE-01', '900010002'), note: 'Matching 855' },
  { rel: 'singles/810_minimal.edi', content: txn810('PO-SMOKE-01', '900010003', 'INV-SMOKE-01'), note: 'Matching 810' },
  { rel: 'singles/856_minimal.edi', content: txn856('PO-SMOKE-01', '900010004', 'SHIP-SMOKE'), note: 'Matching 856' },
  { rel: 'singles/997_accept.edi', content: txn997Accept('900010005'), note: 'Clean functional ack' },
  { rel: 'singles/997_reject_ak3_ak4.edi', content: txn997Reject('900010006'), note: 'Reject with segment/element detail' },

  // Edge cases
  { rel: 'edge-cases/batched_850_and_810.edi', content: batched850810('800010001'), note: 'Two functional groups in one ISA (850 + 810)' },
  { rel: 'edge-cases/850_line_wrapped.edi', content: lineWrapped850('PO-WRAP-01', '800010002'), note: 'CRLF between segments' },
  { rel: 'edge-cases/850_duplicate_isa_control.edi', content: txn850('PO-DUP-01', '100010001'), note: 'Same ISA13 as PO-10001 850 — expect duplicate on re-ingest' },
];

const manifest = {
  generatedAt: new Date().toISOString(),
  tradingPartner: {
    isaSenderId: SENDER,
    isaReceiverId: RECEIVER,
    note: 'Match or update your Partners config if you use different ISA IDs.',
  },
  usage:
    'Copy .edi files into your inbound drop folder (e.g. C:\\EDI\\Inbound). Drop lifecycles in numeric order. Each file has a unique ISA control number except edge-cases/850_duplicate_isa_control.edi (dedup test).',
  lifecycles: [
    {
      poNumber: 'PO-10001',
      folder: 'lifecycles/PO-10001',
      description: 'Full order-to-cash: 850 → 855 → 856 → 810 → 997',
      files: ['01_850_purchase_order.edi', '02_855_acknowledgment.edi', '03_856_ship_notice.edi', '04_810_invoice.edi', '05_997_functional_ack.edi'],
    },
    {
      poNumber: 'PO-10002',
      folder: 'lifecycles/PO-10002',
      description: 'Rejected path: 850 → RJ 855 → 997 with AK3/AK4',
      files: ['01_850_purchase_order.edi', '02_855_rejected_ack.edi', '03_997_reject_detail.edi'],
    },
    {
      poNumber: 'PO-10003',
      folder: 'lifecycles/PO-10003',
      description: 'Grocery: 875 → 880',
      files: ['01_875_grocery_po.edi', '02_880_grocery_invoice.edi'],
    },
    {
      poNumber: 'PO-10004',
      folder: 'lifecycles/PO-10004',
      description: 'PO change: 850 → 860',
      files: ['01_850_purchase_order.edi', '02_860_po_change.edi'],
    },
    {
      poNumber: 'PO-20001',
      folder: 'lifecycles/PO-20001',
      description: 'Short path: 850 → 810 (no ship/ack)',
      files: ['01_850_purchase_order.edi', '02_810_invoice.edi'],
    },
  ],
  singles: files.filter((f) => f.rel.startsWith('singles/')).map((f) => ({ file: f.rel, note: f.note })),
  edgeCases: files.filter((f) => f.rel.startsWith('edge-cases/')).map((f) => ({ file: f.rel, note: f.note })),
  pendingFromRealSamples: [],
  partnerLifecycles: PARTNER_LIFECYCLES.map((lc) => ({
    partner: lc.partner,
    group: lc.id,
    poNumber: lc.po,
    folder: `lifecycles/${lc.partner}/${lc.id}`,
    description: lc.description,
    files: lc.files.map((f) => f.name),
  })),
  referenceSamples: [
    { partner: 'us-foods', note: 'Production-structure samples (17 files). Use for parser regression; prefer synthetic lifecycles for drop testing.' },
    { partner: 'sysco', note: 'Production-structure samples included in reference/ folder.' },
  ],
};

async function main() {
  let ok = 0;
  for (const { rel, content } of files) {
    const path = join(outRoot, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
    decomposeInterchange(content);
    ok++;
  }

  for (const lc of PARTNER_LIFECYCLES) {
    for (const file of lc.files) {
      const rel = `lifecycles/${lc.partner}/${lc.id}/${file.name}`;
      const content = file.build();
      const path = join(outRoot, rel);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
      const txn = decomposeInterchange(content).interchange.groups[0].transactions[0];
      const keys = extractBusinessKeys(txn);
      if (keys.poNumber !== lc.po) {
        throw new Error(`${rel}: expected PO ${lc.po}, got ${keys.poNumber}`);
      }
      ok++;
    }
  }

  const referenceDir = join(outRoot, 'reference');
  await mkdir(referenceDir, { recursive: true });
  await writeFile(
    join(referenceDir, 'README.md'),
    `# Reference EDI samples

Production-structure files from US Foods and Sysco (provided for template analysis).
These contain real PO numbers and partner data — use the **synthetic** copies under
\`lifecycles/us-foods/\` and \`lifecycles/sysco/\` for routine drop-folder testing.

Do not commit additional production data here without redaction.
`,
    'utf8',
  );

  await writeFile(join(outRoot, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const readme = `# Test Files — synthetic EDI library

Synthetic X12 4010 files for manual drop-folder testing. Generated by \`npm run generate:test-edi\`.

## Partner-faithful lifecycles (recommended)

Derived from production US Foods and Sysco samples — pipe delimiters, partner segment
patterns, but **synthetic PO/invoice numbers and test names**.

| Partner | Folder | PO numbers | Documents |
|---------|--------|------------|-----------|
| US Foods | \`lifecycles/us-foods/group-1/\` | \`7599901Q\` | 850 → 855 (AP) → 810 |
| US Foods | \`lifecycles/us-foods/group-2/\` | \`7599902F\` | 850 → 855 → 810 |
| US Foods | \`lifecycles/us-foods/group-3/\` | \`7599903Q\` | 850 → 855 → 810 |
| Sysco | \`lifecycles/sysco/group-1/\` | \`31999001\` | 850 → 855 (AC+ACK) → 810 — prepaid/pickup |
| Sysco | \`lifecycles/sysco/group-2/\` | \`11999002\` | 850 → 855 → 810 — collect/freight SAC |
| Sysco | \`lifecycles/sysco/group-3/\` | \`42999045\` | 850 → 855 → 810 — Sygma KY |

ISA IDs match production shape: US Foods \`621418185\`, Sysco \`109563165\`, vendor \`7085892400\`.

## Generic lifecycles (asterisk-delimited)

| Folder | PO | Path |
|--------|-----|------|
| Full loop | PO-10001 | \`lifecycles/PO-10001/\` |
| Rejected ack | PO-10002 | \`lifecycles/PO-10002/\` |
| Grocery | PO-10003 | \`lifecycles/PO-10003/\` |
| PO change | PO-10004 | \`lifecycles/PO-10004/\` |

## Quick start

1. Drop \`lifecycles/us-foods/group-1/01_850_purchase_order.edi\` into \`C:\\EDI\\Inbound\`
2. Confirm **Transactions** shows PO \`7599901Q\`
3. Drop \`02\` then \`03\` — search Lifecycle for the PO

## Folder layout

| Folder | Purpose |
|--------|---------|
| \`lifecycles/us-foods/\`, \`lifecycles/sysco/\` | Partner-faithful synthetic sets |
| \`lifecycles/PO-*\` | Generic asterisk-delimited sets |
| \`singles/\` | One-off smoke tests |
| \`edge-cases/\` | Batched interchanges, dedup, line wrapping |
| \`reference/\` | Original production-structure samples (read-only reference) |

See \`MANIFEST.json\` for the full catalog.

## Regenerate

\`\`\`bash
npm run generate:test-edi
\`\`\`
`;

  await writeFile(join(outRoot, 'README.md'), readme, 'utf8');
  console.log(`Wrote ${ok} EDI files + MANIFEST.json + README.md under Test Files/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
