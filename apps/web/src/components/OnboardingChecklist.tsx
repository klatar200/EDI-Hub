/**
 * Empty-hub onboarding — shown on the Lifecycles homepage when a tenant has
 * no PO conversations yet AND hasn't finished the first-value path. Works in
 * both web/SaaS and desktop: it links to existing pages and derives each
 * step's done/todo state from data the page already loads (partners + setup),
 * so it needs no new API surface. Disappears on its own once the first
 * lifecycle stitches.
 */
import { Link } from 'react-router-dom';
import { Card } from './ui/Card.tsx';

interface Step {
  done: boolean;
  title: string;
  body: string;
  to: string;
  cta: string;
}

function StepRow({ step, index }: { step: Step; index: number }): JSX.Element {
  return (
    <li className="flex items-start gap-3" data-testid={`onboarding-step-${index}`}>
      <span
        aria-hidden
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
          step.done
            ? 'bg-[var(--color-success-500)] text-white'
            : 'border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] text-[var(--color-fg-muted)]'
        }`}
      >
        {step.done ? '✓' : index}
      </span>
      <div className="flex-1">
        <p
          className={`text-sm font-medium ${
            step.done
              ? 'text-[var(--color-fg-subtle)] line-through'
              : 'text-[var(--color-fg)]'
          }`}
        >
          {step.title}
        </p>
        <p className="mt-0.5 text-sm text-[var(--color-fg-muted)]">{step.body}</p>
        {step.done ? null : (
          <Link
            to={step.to}
            className="mt-2 inline-flex items-center gap-1 rounded-md bg-[var(--color-brand-600)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-brand-700)]"
          >
            {step.cta} →
          </Link>
        )}
      </div>
    </li>
  );
}

export function OnboardingChecklist({
  partnerDone,
  ingestDone,
}: {
  partnerDone: boolean;
  ingestDone: boolean;
}): JSX.Element {
  const steps: Step[] = [
    {
      done: partnerDone,
      title: 'Add your first trading partner',
      body: "Tell the hub who's sending EDI — their ISA sender IDs and the transaction sets they use. This is what lets inbound files be recognized and classified.",
      to: '/partners-config',
      cta: 'Add a partner',
    },
    {
      done: ingestDone,
      title: 'Upload your first EDI file',
      body: 'Upload an X12 file directly, or drop one into a watched SFTP / AS2 folder. The hub stores the raw transmission, parses it, and starts stitching the lifecycle.',
      to: '/ingestions',
      cta: 'Upload a file',
    },
  ];

  return (
    <Card className="mx-auto max-w-2xl p-6" data-testid="onboarding-checklist">
      <h2 className="text-base font-semibold text-[var(--color-fg)]">
        Welcome to EDI Hub — let&apos;s get your first PO on the board
      </h2>
      <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
        This hub stitches every related document — the 850, 855, 856, 810, and all 997s — into
        one chronological view per purchase order. Two quick steps to see it work:
      </p>
      <ol className="mt-5 space-y-5">
        {steps.map((step, i) => (
          <StepRow key={step.to} step={step} index={i + 1} />
        ))}
      </ol>
      <p className="mt-6 border-t border-[var(--color-surface-border)] pt-4 text-xs text-[var(--color-fg-subtle)]">
        This checklist clears itself as soon as your first PO lifecycle appears here.
      </p>
    </Card>
  );
}
