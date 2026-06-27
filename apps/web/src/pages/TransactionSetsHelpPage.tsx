/**
 * PS-8 — Transaction set glossary (F59) + phased roadmap (F31).
 */
import { PageHeader, Card } from '../components/ui';

const SETS = [
  { id: '850', name: 'Purchase Order', desc: 'Buyer sends a PO — line items, quantities, and requested delivery.' },
  { id: '855', name: 'PO Acknowledgment', desc: 'Supplier confirms, changes, or rejects the PO (accept / reject / change).' },
  { id: '856', name: 'Ship Notice / ASN', desc: 'Shipment notification with carton/pallet hierarchy and ship date.' },
  { id: '810', name: 'Invoice', desc: 'Supplier invoice referencing the PO with amounts and line detail.' },
  { id: '997', name: 'Functional Acknowledgment', desc: 'Technical ack that a functional group was received — includes AK3/AK4 errors.' },
];

const TIERS = [
  {
    tier: 'Tier A — North Star core',
    sets: '850, 855, 856, 810, 997',
    scope: 'Full lifecycle stitching, typed headers on expand, missing-ack detection, rejection detail, and export.',
    status: 'Shipped',
  },
  {
    tier: 'Tier B — Extended grocery / PO change',
    sets: '860, 875, 880',
    scope: 'Generic parse + lifecycle participation; grocery flow (875→880) and PO change (860) without bespoke UI per set.',
    status: 'Partial — parser + lifecycle; detail headers follow Tier A pattern as sets mature.',
  },
  {
    tier: 'Tier C — Future / partner-specific',
    sets: '999, proprietary Z-segments, calendar SLAs',
    scope: 'Requires explicit sprint approval — see BUILD_PLAN §12 and FUTURE_FEATURES.md before expanding scope.',
    status: 'Not in v1',
  },
];

export function TransactionSetsHelpPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <PageHeader title="Transaction sets" subtitle="Plain-English guide to the order-to-cash loop." />
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
          Phased roadmap (F31)
        </h2>
        <div className="grid gap-3">
          {TIERS.map((t) => (
            <Card key={t.tier} className="p-4" data-testid={`tier-${t.tier.split(' ')[0]?.toLowerCase()}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-[var(--color-fg)]">{t.tier}</span>
                <span className="text-xs text-[var(--color-fg-muted)]">{t.status}</span>
              </div>
              <p className="mt-1 font-mono text-sm text-[var(--color-brand-700)]">{t.sets}</p>
              <p className="mt-2 text-sm text-[var(--color-fg-muted)]">{t.scope}</p>
            </Card>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
          Glossary
        </h2>
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
      </section>
    </div>
  );
}
