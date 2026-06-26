/**
 * Partner-faithful X12 builders (pipe-delimited, CRLF segments) derived from
 * production US Foods and Sysco samples. Used by scripts/generate-test-edi.mjs.
 */

function pipeIsa({ qualSender, idSender, qualReceiver, idReceiver, date, time, isa13 }) {
  const body = [
    'ISA', '00', '          ', '00', '          ',
    qualSender, idSender.padEnd(15), qualReceiver, idReceiver.padEnd(15),
    date, time, 'U', '00401', isa13.padStart(9, '0'), '0', 'P', '>',
  ].join('|');
  if (body.length !== 105) {
    throw new Error(`pipeIsa: expected 105-char ISA body, got ${body.length}`);
  }
  return body;
}

/** @param {string[]} segments Raw segment strings (no terminators) */
function formatInterchange(segments) {
  const isa = segments[0];
  if (isa.length !== 105) {
    throw new Error(`formatInterchange: ISA must be 105 chars, got ${isa.length}`);
  }
  return segments.join('\r\n') + '\r\n';
}

function finalizeInterchange(segments, { stControl, gsControl, isa13 }) {
  const stIdx = segments.findIndex((s) => s.startsWith('ST|'));
  const seCount = segments.length - stIdx + 1;
  segments.push(`SE|${seCount}|${stControl}`);
  segments.push(`GE|1|${gsControl}`);
  segments.push(`IEA|1|${isa13.padStart(9, '0')}`);
  return formatInterchange(segments);
}

const USF = {
  buyerId: '621418185',
  vendorId: '7085892400',
  vendorName: 'TEST VENDOR PACKING LLC',
  vendorDuns: '097750',
  itemPi: '1199901',
  gtin: '00850068673131',
  productDesc: 'SHORTENING, ANIMAL BEEF SOLID NATURAL CUBE BOX SHELF STABLE',
};

const SYSCO = {
  buyerId: '109563165',
  vendorId: '7085892400',
  vendorDuns: '064412851',
  vendorName: 'TEST VENDOR PACKING LLC',
  corpDuns: '1095276680000',
};

/**
 * US Foods 850 — pipe delimiter, `>` terminator, BEG/SA, MSG boilerplate, PO1 w/o line#.
 */
export function usFoods850({
  po,
  isa13,
  stControl,
  gsControl,
  qty = 72,
  casePrice = '68.33',
  shipDate = '20260715',
  dcName = 'US FOODS TEST DC - SPOKANE',
  dcDuns = '027514553',
  buyerContact = 'TEST BUYER',
  buyerPhone = '5095550100',
  buyerEmail = 'buyer.test@example.com',
}) {
  const segments = [
    pipeIsa({
      qualSender: '01', idSender: USF.buyerId, qualReceiver: '12', idReceiver: USF.vendorId,
      date: '260701', time: '0633', isa13,
    }),
    `GS|PO|${USF.buyerId}|${USF.vendorId}|20260701|0633|${gsControl}|X|004010`,
    `ST|850|${stControl}`,
    `BEG|00|SA|${po}||20260701`,
    'ITD|36||0||0||30',
    `DTM|002|${shipDate}`,
    'TD5|O|||M',
    `N9|PO|${po}`,
    'MSG|TEST: supply the PO number on the bill of lading for shipments to US Foods.',
    'MSG|TEST: merchandise received on pallets only, broken down by item.',
    `N1|ST|${dcName}|1|${dcDuns}`,
    'N3|1000 TEST RECEIVING LANE',
    'N4|TESTVILLE|WA|990000000',
    `N1|SF|${USF.vendorName}|91|${USF.vendorDuns}`,
    'N3|100 TEST INDUSTRIAL BLVD',
    'N4|TEST CITY|IL|606000000',
    `PER|BD|${buyerContact}|TE|${buyerPhone}|||EM|${buyerEmail}|920`,
    `PO1||${qty}|CA|${casePrice}|PE|UK|${USF.gtin}|PI|${USF.itemPi}|MG|81108|BL|${USF.vendorName}`,
    `PID|F||||${USF.productDesc}`,
    'REF|ZZ|50 LB',
    'CTT|1',
  ];
  return finalizeInterchange(segments, { stControl, gsControl, isa13 });
}

/**
 * US Foods 855 — `}` terminator, BAK/AP, per-pound PP pricing on PO1.
 */
export function usFoods855({
  po,
  poDate,
  isa13,
  gsControl,
  qty = 72,
  lbPrice = '1.5005',
  shipDate = '20260714',
  dcName = 'US FOODS TEST DC - SPOKANE',
  dcDuns = '027514553',
}) {
  const segments = [
    pipeIsa({
      qualSender: '12', idSender: USF.vendorId, qualReceiver: '01', idReceiver: USF.buyerId,
      date: '260702', time: '1151', isa13,
    }),
    `GS|PR|${USF.vendorId}|${USF.buyerId}|20260702|1151|${gsControl}|X|004010`,
    'ST|855|0001',
    `BAK|00|AP|${po}|${poDate}`,
    `DTM|002|${shipDate}`,
    'TD5||||M',
    `N1|ST|${dcName}|1|${dcDuns}`,
    `PER|SU|CUSTOMER SERVICE|TE|${USF.vendorId}`,
    `PO1||${qty}|CA|${lbPrice}|PP|||PI|${USF.itemPi}`,
    'PID|F||||NATURAL ALL CRISP',
    'CTT|1',
  ];
  return finalizeInterchange(segments, { stControl: '0001', gsControl, isa13 });
}

/**
 * US Foods 810 — `}` terminator, BIG with DI qualifier, IT1/IT3/ISS weight pattern.
 */
export function usFoods810({
  po,
  poDate,
  invoiceDate,
  invoiceNumber,
  isa13,
  gsControl,
  qty = 72,
  lbs = '3600.00',
  lbPrice = '1.5005',
  total = '540180',
  dcName = 'US FOODS TEST DC - SPOKANE',
  dcDuns = '027514553',
  apRef = '0000599001',
}) {
  const segments = [
    pipeIsa({
      qualSender: '12', idSender: USF.vendorId, qualReceiver: '01', idReceiver: USF.buyerId,
      date: '260710', time: '1301', isa13,
    }),
    `GS|IN|${USF.vendorId}|${USF.buyerId}|20260710|1301|${gsControl}|X|004010`,
    'ST|810|0007',
    `BIG|${invoiceDate}|${invoiceNumber}|${poDate}|${po}|||DI|00`,
    `REF|AP|${apRef}`,
    `N1|ST|${dcName}|1|${dcDuns}`,
    'N3|1000 TEST RECEIVING LANE',
    'N4|TESTVILLE|WA|99000|US',
    `N1|RE|${USF.vendorName}|1|795140433`,
    'N3|00000-0000',
    'N4|TEST STREAM|IL|60100-0000|US',
    `N1|VN|${USF.vendorName}|1|795140433`,
    `PER|SU|CUSTOMER SERVICE|TE|${USF.vendorId}`,
    'ITD|01|3||||20270809|30',
    `IT1|1|${lbs}|LB|${lbPrice}||||PI|${USF.itemPi}`,
    `IT3|${qty}|CA`,
    'PID|F||||NATURAL ALL CRISP',
    `TDS|${total}`,
    `ISS|${qty}|CA|${lbs.replace('.00', '')}|LB`,
    'CTT|1',
  ];
  return finalizeInterchange(segments, { stControl: '0007', gsControl, isa13 });
}

/**
 * Sysco 850 — pipe delimiter, `^` terminator, BEG/NE, REF/FOB/SAC pattern.
 */
export function sysco850({
  po,
  isa13,
  stControl,
  gsControl,
  qty = 180,
  casePrice = '47.558',
  shipDate = '20260710',
  cancelDate = '20260709',
  dcName = 'SYSCO TEST DC - DES PLAINES',
  dcDuns = '8065506040000',
  ocCode = 'FI9312',
  internalRef = '132990001',
  fob = 'PB',
  sacCode = 'F340',
  sacType = 'A',
  sacCharge = '0.01',
  sacDesc = 'PICKUP ALLOWANCE - RATE PER 100 NWT',
  lineNo = '1',
  itemPi = '7369901',
  itemVp = '84132',
  gtin = '00850068673094',
  productDesc = 'TEST ALL FRY NATURAL',
}) {
  const segments = [
    pipeIsa({
      qualSender: '01', idSender: SYSCO.buyerId, qualReceiver: '12', idReceiver: SYSCO.vendorId,
      date: '260701', time: '0729', isa13,
    }),
    `GS|PO|${SYSCO.buyerId}|${SYSCO.vendorId}|20260701|0729|${gsControl}|X|004010`,
    `ST|850|${stControl}`,
    `BEG|00|NE|${po}||20260701`,
    `REF|CR|${ocCode}`,
    `REF|IL|${internalRef}`,
    'REF|YD|C41|TEST BUYER NAME',
    'REF|VR|50999001',
    'REF|ZI|2',
    'REF|YB|0',
    `FOB|${fob}`,
    sacType === 'C'
      ? `SAC|C|${sacCode}|||${sacCharge}|||||||06|||${sacDesc}`
      : `SAC|A|${sacCode}||||||${sacCharge}|PN|63||02|||${sacDesc}`,
    `DTM|002|${shipDate}`,
    `DTM|010|${cancelDate}`,
    'TD5||||H',
    'N9|L1|GEN',
    'MSG|TEST VENDOR REFERENCE # 50999001',
    `MSG|Extra Services ${sacCode} - Pick/Up Added`,
    `MSG|SYSCO OC ${ocCode}`,
    `N1|BT|SYSCO TEST CORP|91|${SYSCO.corpDuns}`,
    'N3|1000 TEST PARKWAY',
    'N4|TEST CITY|TX|77000|USA',
    `N1|ST|${dcName}|91|${dcDuns}`,
    'N3|200 TEST DISTRIBUTION DR',
    'N4|TEST PLAINES|IL|60000',
    `N1|BY|SYSCO TEST CORP|91|${SYSCO.corpDuns}`,
    'N3|1000 TEST PARKWAY',
    'N4|TEST CITY|TX|77000|USA',
    `N1|VN|${SYSCO.vendorName}|9|${SYSCO.vendorDuns}`,
    'N3|300 TEST SHIP TO AVE',
    'N4|TEST HOLLAND|IL|60400|USA',
    `N1|SF|${SYSCO.vendorName}|9|${SYSCO.vendorDuns}`,
    'N3|400 TEST PLANT ST UNIT A',
    'N4|TEST TOWN|IL|60400',
    `PO1|${lineNo}|${qty}|CA|${casePrice}|PE|UK|${gtin}|VP|${itemVp}|PI|${itemPi}`,
    `PID|F||||${productDesc}`,
    `CTT|1|${qty}`,
  ];
  return finalizeInterchange(segments, { stControl, gsControl, isa13 });
}

/**
 * Sysco 855 — BAK/AC, ACK segment, optional SAC on freight orders.
 */
export function sysco855({
  po,
  poDate,
  isa13,
  gsControl,
  qty = 180,
  casePrice = '47.56',
  shipDate = '20260710',
  dcName = 'SYSCO TEST DC - DES PLAINES',
  dcDuns = '8065506040000',
  internalRef = '132990001',
  vendorRef = '268990',
  lineNo = '1',
  itemPi = '7369901',
  itemVp = '84132',
  gtin = '00850068673094',
  productDesc = 'TEST ALL FRY NATURAL 35LB',
  sacLine = null,
}) {
  const segments = [
    pipeIsa({
      qualSender: '12', idSender: SYSCO.vendorId, qualReceiver: '01', idReceiver: SYSCO.buyerId,
      date: '260702', time: '1311', isa13,
    }),
    `GS|PR|${SYSCO.vendorId}|${SYSCO.buyerId}|20260702|1311|${gsControl}|X|004010`,
    'ST|855|0006',
    `BAK|00|AC|${po}|${poDate}|||||${poDate}`,
    `REF|IL|${internalRef}`,
    `REF|VN|${vendorRef}`,
    `DTM|118|${shipDate}`,
    'TD5||||H',
    'N1|BT|SYSCO-TEST|91|1095276680000',
    `N1|ST|${dcName}|91|${dcDuns}`,
    'N1|BY|SYSCO-TEST|91|1095276680000',
    'N1|VN|TEST PLANT|91|064412851',
    `N1|SF|${SYSCO.vendorName}|91|${SYSCO.vendorDuns}`,
    `PO1|${lineNo}|${qty}|CA|${casePrice}|PP|UK|${gtin}|VP|${itemVp}|PI|${itemPi}`,
    `PID|F||||${productDesc}`,
    `ACK|IP|${qty}|CA`,
    'CTT|1',
  ];
  if (sacLine) segments.splice(6, 0, sacLine);
  return finalizeInterchange(segments, { stControl: '0006', gsControl, isa13 });
}

/**
 * Sysco 810 — `@` terminator, BIG/REF/IT1/IT3/ISS pattern.
 */
export function sysco810({
  po,
  poDate,
  invoiceDate,
  invoiceNumber,
  isa13,
  gsControl,
  qty = 180,
  lbs = '6300.00',
  lbPrice = '1.36',
  total = '856044',
  internalRef = '132990001',
  vendorRef = '268990',
  bolRef = '209990',
  lineNo = '1',
  itemPi = '7369901',
  itemVp = '84132',
  gtin = '00850068673094',
  productDesc = 'Test All Fry Natural 35lb',
}) {
  const segments = [
    pipeIsa({
      qualSender: '12', idSender: SYSCO.vendorId, qualReceiver: '01', idReceiver: SYSCO.buyerId,
      date: '260710', time: '1451', isa13,
    }),
    `GS|IN|${SYSCO.vendorId}|${SYSCO.buyerId}|20260710|1451|${gsControl}|X|004010`,
    'ST|810|0003',
    `BIG|${invoiceDate}|${invoiceNumber}|${poDate}|${po}||||00`,
    `REF|BM|${bolRef}`,
    `REF|VN|${vendorRef}`,
    `REF|IL|${internalRef}`,
    'N1|BY|SYSCO TEST CORP|9|1095276680000',
    'N3|1000 TEST PARKWAY',
    'N4|TEST CITY|TX|77000|USA',
    `N1|RE|${SYSCO.vendorName}|92|007994361`,
    'N3|P O Box 0000',
    'N4|Test Stream|IL|60100-0000|US',
    `N1|VN|${SYSCO.vendorName}|9|${SYSCO.vendorDuns}`,
    'N3|300 TEST SHIP TO AVE',
    'N4|Test Holland|IL|60400|USA',
    'ITD|01|3||||20270824|45|||||NET 45',
    `DTM|011|${invoiceDate}`,
    `IT1|${lineNo}|${lbs}|LB|${lbPrice}|PP|PI|${itemPi}|VN|${itemVp}|UK|${gtin}`,
    `IT3|${qty}|CA`,
    `PID|F||||${productDesc}`,
    `TDS|${total}`,
    `ISS|${qty}|CA|${lbs.replace('.00', '')}|LB`,
    `CTT|1|${lbs.replace('.00', '')}`,
  ];
  return finalizeInterchange(segments, { stControl: '0003', gsControl, isa13 });
}

/** @type {{ id: string, po: string, partner: string, description: string, files: { name: string, build: () => string }[] }[]} */
export const PARTNER_LIFECYCLES = [
  {
    id: 'group-1',
    partner: 'us-foods',
    po: '7599901Q',
    description: 'US Foods Spokane pattern (mirrors production group 1)',
    files: [
      {
        name: '01_850_purchase_order.edi',
        build: () =>
          usFoods850({
            po: '7599901Q',
            isa13: '000059901',
            stControl: '9901',
            gsControl: '9901',
            qty: 72,
            dcName: 'US FOODS TEST DC - SPOKANE',
            dcDuns: '027514553',
          }),
      },
      {
        name: '02_855_acknowledgment.edi',
        build: () =>
          usFoods855({
            po: '7599901Q',
            poDate: '20260701',
            isa13: '000059902',
            gsControl: '9902',
            qty: 72,
            lbPrice: '1.5005',
          }),
      },
      {
        name: '03_810_invoice.edi',
        build: () =>
          usFoods810({
            po: '7599901Q',
            poDate: '20260701',
            invoiceDate: '20260709',
            invoiceNumber: '5199901',
            isa13: '000059903',
            gsControl: '9903',
            qty: 72,
            total: '540180',
          }),
      },
    ],
  },
  {
    id: 'group-2',
    partner: 'us-foods',
    po: '7599902F',
    description: 'US Foods Minnesota pattern (mirrors production group 2)',
    files: [
      {
        name: '01_850_purchase_order.edi',
        build: () =>
          usFoods850({
            po: '7599902F',
            isa13: '000059904',
            stControl: '9904',
            gsControl: '9904',
            qty: 72,
            casePrice: '66.97',
            shipDate: '20260720',
            dcName: 'US FOODS TEST DC - MINNESOTA',
            dcDuns: '088694260',
            buyerContact: 'TEST BUYER MN',
            buyerPhone: '7635550100',
            buyerEmail: 'buyer.mn.test@example.com',
          }),
      },
      {
        name: '02_855_acknowledgment.edi',
        build: () =>
          usFoods855({
            po: '7599902F',
            poDate: '20260701',
            isa13: '000059905',
            gsControl: '9905',
            qty: 72,
            lbPrice: '1.3394',
            shipDate: '20260719',
            dcName: 'US FOODS TEST DC - MINNESOTA',
            dcDuns: '088694260',
          }),
      },
      {
        name: '03_810_invoice.edi',
        build: () =>
          usFoods810({
            po: '7599902F',
            poDate: '20260701',
            invoiceDate: '20260718',
            invoiceNumber: '5199902',
            isa13: '000059906',
            gsControl: '9906',
            qty: 72,
            lbs: '3600.00',
            lbPrice: '1.3394',
            total: '481776',
            dcName: 'US FOODS TEST DC - MINNESOTA',
            dcDuns: '088694260',
          }),
      },
    ],
  },
  {
    id: 'group-3',
    partner: 'us-foods',
    po: '7599903Q',
    description: 'US Foods Spokane higher-qty pattern (mirrors production group 3)',
    files: [
      {
        name: '01_850_purchase_order.edi',
        build: () =>
          usFoods850({
            po: '7599903Q',
            isa13: '000059907',
            stControl: '9907',
            gsControl: '9907',
            qty: 108,
            shipDate: '20260722',
          }),
      },
      {
        name: '02_855_acknowledgment.edi',
        build: () =>
          usFoods855({
            po: '7599903Q',
            poDate: '20260701',
            isa13: '000059908',
            gsControl: '9908',
            qty: 108,
            lbPrice: '1.4190',
            shipDate: '20260720',
          }),
      },
      {
        name: '03_810_invoice.edi',
        build: () =>
          usFoods810({
            po: '7599903Q',
            poDate: '20260701',
            invoiceDate: '20260717',
            invoiceNumber: '5199903',
            isa13: '000059909',
            gsControl: '9909',
            qty: 108,
            lbs: '5400.00',
            lbPrice: '1.4190',
            total: '766260',
          }),
      },
    ],
  },
  {
    id: 'group-1',
    partner: 'sysco',
    po: '31999001',
    description: 'Sysco Chicago prepaid/pickup allowance (mirrors production group 1)',
    files: [
      {
        name: '01_850_purchase_order.edi',
        build: () =>
          sysco850({
            po: '31999001',
            isa13: '242990001',
            stControl: '99010001',
            gsControl: '99010001',
            qty: 180,
            fob: 'PB',
            sacCode: 'F340',
            sacAmount: '0.01',
            ocCode: 'FI9312',
            internalRef: '132990001',
          }),
      },
      {
        name: '02_855_acknowledgment.edi',
        build: () =>
          sysco855({
            po: '31999001',
            poDate: '20260701',
            isa13: '000059910',
            gsControl: '9910',
            qty: 180,
            vendorRef: '268990',
            internalRef: '132990001',
          }),
      },
      {
        name: '03_810_invoice.edi',
        build: () =>
          sysco810({
            po: '31999001',
            poDate: '20260701',
            invoiceDate: '20260709',
            invoiceNumber: '5199911',
            isa13: '000059911',
            gsControl: '9911',
            qty: 180,
            vendorRef: '268990',
            internalRef: '132990001',
            bolRef: '209991',
          }),
      },
    ],
  },
  {
    id: 'group-2',
    partner: 'sysco',
    po: '11999002',
    description: 'Sysco Riverside collect/freight SAC (mirrors production group 2)',
    files: [
      {
        name: '01_850_purchase_order.edi',
        build: () =>
          sysco850({
            po: '11999002',
            isa13: '242990002',
            stControl: '99020002',
            gsControl: '99020002',
            qty: 504,
            casePrice: '57.94',
            shipDate: '20260705',
            cancelDate: '20260704',
            fob: 'PP',
            sacCode: 'D240',
            sacType: 'C',
            sacCharge: '143000',
            sacDesc: 'FREIGHT - RATE PER POUND',
            ocCode: 'HI9376',
            internalRef: '132990002',
            dcName: 'SYSCO TEST DC - RIVERSIDE',
            dcDuns: '0787361800000',
            lineNo: '2',
            itemPi: '7419902',
            itemVp: '81108',
            gtin: '00850068673131',
            productDesc: 'NATURAL ALL CRISP - DEOD TALLOW',
          }),
      },
      {
        name: '02_855_acknowledgment.edi',
        build: () =>
          sysco855({
            po: '11999002',
            poDate: '20260701',
            isa13: '000059912',
            gsControl: '9912',
            qty: 504,
            casePrice: '57.94',
            shipDate: '20260705',
            dcName: 'SYSCO TEST DC - RIVERSIDE',
            dcDuns: '0787361800000',
            internalRef: '132990002',
            vendorRef: '268991',
            lineNo: '2',
            itemPi: '7419902',
            itemVp: '81108',
            gtin: '00850068673131',
            productDesc: 'NATURAL ALL CRISP',
            sacLine: 'SAC|C|D240|||327500|||||||06',
          }),
      },
      {
        name: '03_810_invoice.edi',
        build: () =>
          sysco810({
            po: '11999002',
            poDate: '20260701',
            invoiceDate: '20260704',
            invoiceNumber: '5199912',
            isa13: '000059913',
            gsControl: '9913',
            qty: 504,
            lbs: '25200.00',
            lbPrice: '1.16',
            total: '2920176',
            internalRef: '132990002',
            vendorRef: '268991',
            bolRef: '209992',
            lineNo: '2',
            itemPi: '7419902',
            itemVp: '81108',
            gtin: '00850068673131',
          }),
      },
    ],
  },
  {
    id: 'group-3',
    partner: 'sysco',
    po: '42999045',
    description: 'Sysco Sygma Kentucky freight pattern (mirrors production group 3)',
    files: [
      {
        name: '01_850_purchase_order.edi',
        build: () =>
          sysco850({
            po: '42999045',
            isa13: '242990003',
            stControl: '99030003',
            gsControl: '99030003',
            qty: 828,
            casePrice: '42.68',
            shipDate: '20260719',
            cancelDate: '20260718',
            fob: 'PP',
            sacCode: 'D240',
            sacType: 'C',
            sacCharge: '181746',
            sacDesc: 'FREIGHT - RATE PER POUND',
            ocCode: 'VI9643',
            internalRef: '132990003',
            dcName: 'SYGMA TEST DC - KENTUCKY',
            dcDuns: '0000118658130',
            itemPi: '7309903',
            itemVp: '81338',
            gtin: '00850068673049',
            productDesc: 'TEST ALL CRISP HEAVY DUTY SHORTENING',
          }),
      },
      {
        name: '02_855_acknowledgment.edi',
        build: () =>
          sysco855({
            po: '42999045',
            poDate: '20260701',
            isa13: '000059914',
            gsControl: '9914',
            qty: 828,
            casePrice: '42.68',
            shipDate: '20260719',
            dcName: 'SYGMA TEST DC - KENTUCKY',
            dcDuns: '0000118658130',
            internalRef: '132990003',
            vendorRef: '268992',
            itemPi: '7309903',
            itemVp: '81338',
            gtin: '00850068673049',
            productDesc: '50 LB CUBE',
            sacLine: 'SAC|C|D240|||181746|||||||06',
          }),
      },
      {
        name: '03_810_invoice.edi',
        build: () =>
          sysco810({
            po: '42999045',
            poDate: '20260701',
            invoiceDate: '20260718',
            invoiceNumber: '5199913',
            isa13: '000059915',
            gsControl: '9915',
            qty: 828,
            lbs: '41400.00',
            lbPrice: '0.86',
            total: '3575304',
            internalRef: '132990003',
            vendorRef: '268992',
            bolRef: '209993',
            itemPi: '7309903',
            itemVp: '81338',
            gtin: '00850068673049',
            productDesc: '50 LB CUBE',
          }),
      },
    ],
  },
];
