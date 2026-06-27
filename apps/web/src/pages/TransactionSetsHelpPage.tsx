/**
 * PS-8 — Transaction set glossary (F59).
 */
import { PageHeader, Card } from '../components/ui';

const SETS = [
  { id: '850', name: 'Purchase Order', desc: 'Buyer sends a PO — line items, quantities, and requested delivery.' },
  { id: '855', name: 'PO Acknowledgment', desc: 'Supplier confirms, changes, or rejects the PO (accept / reject / change).' },
  { id: '856', name: 'Ship Notice / ASN', desc: 'Shipment notification with carton/pallet hierarchy and ship date.' },
  { id: '810', name: 'Invoice', desc: 'Supplier invoice referencing the PO with amounts and line detail.' },
  { id: '997', name: 'Functional Acknowledgment', desc: 'Technical ack that a functional group was received — includes AK3/AK4 errors.' },
];

export function TransactionSetsHelpPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <PageHeader title="Transaction sets" subtitle="Plain-English guide to the order-to-cash loop." />
      <div className="grid gap-4">
        {SETS.map((s) => (
          <Card key={s.id} className="p-4">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-lg font-semibold">{s.id}</span>
              <span className="text-sm font-medium">{s.name}</span>
            </div>
            <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{s.desc}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
