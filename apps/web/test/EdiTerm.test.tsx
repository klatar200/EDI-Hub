import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { EdiTerm } from '../src/components/EdiTerm.tsx';
import { TooltipProvider } from '../src/components/ui/Tooltip.tsx';

function renderTerm(term: string) {
  return render(
    <TooltipProvider>
      <EdiTerm term={term} />
    </TooltipProvider>,
  );
}

test('EdiTerm renders glossary term with accessible label', () => {
  renderTerm('850');
  const btn = screen.getByTestId('edi-term-850');
  expect(btn).toHaveTextContent('850');
  expect(btn).toHaveAttribute('aria-label', expect.stringContaining('Purchase Order'));
});

test('EdiTerm falls back to plain text for unknown terms', () => {
  render(<EdiTerm term="ZZZ" />);
  expect(screen.getByText('ZZZ')).toBeInTheDocument();
  expect(screen.queryByTestId('edi-term-ZZZ')).toBeNull();
});
