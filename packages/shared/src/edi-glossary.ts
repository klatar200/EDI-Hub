/**
 * U5/O1 — canonical EDI jargon definitions for inline tooltips + Help glossary.
 * Single source so TransactionSetsHelpPage and EdiTerm stay in sync.
 */
export interface EdiGlossaryEntry {
  /** Lookup key — transaction set id (850) or acronym (ISA, AK5). */
  term: string;
  name: string;
  description: string;
}

export const EDI_GLOSSARY_ENTRIES: readonly EdiGlossaryEntry[] = [
  { term: '850', name: 'Purchase Order', description: 'Buyer sends a PO — line items, quantities, and requested delivery.' },
  { term: '855', name: 'PO Acknowledgment', description: 'Supplier confirms, changes, or rejects the PO (accept / reject / change).' },
  { term: '856', name: 'Ship Notice / ASN', description: 'Shipment notification with carton/pallet hierarchy and ship date.' },
  { term: '810', name: 'Invoice', description: 'Supplier invoice referencing the PO with amounts and line detail.' },
  { term: '997', name: 'Functional Acknowledgment', description: 'Technical ack that a functional group was received — includes AK3/AK4 errors.' },
  { term: '860', name: 'PO Change', description: 'Buyer revises an existing PO — references the original PO number (BCH).' },
  { term: '875', name: 'Grocery PO', description: 'Grocery-industry purchase order (BPO) — anchors the 875→880 grocery flow.' },
  { term: '880', name: 'Grocery Invoice', description: 'Grocery supplier invoice (BIG) referencing the grocery PO.' },
  {
    term: 'ISA',
    name: 'Interchange envelope',
    description: 'The outer X12 envelope (ISA/IEA) that wraps a transmission. ISA06/08 carry sender and receiver interchange IDs.',
  },
  {
    term: 'AK5',
    name: 'Transaction set response',
    description: '997 segment summarizing accept/reject for a transaction set. AK501 is the overall ack code (A=accepted, R=rejected).',
  },
];

export const EDI_GLOSSARY: Readonly<Record<string, EdiGlossaryEntry>> = Object.fromEntries(
  EDI_GLOSSARY_ENTRIES.map((e) => [e.term, e]),
);

export function lookupEdiGlossary(term: string): EdiGlossaryEntry | undefined {
  return EDI_GLOSSARY[term] ?? EDI_GLOSSARY[term.toUpperCase()];
}
