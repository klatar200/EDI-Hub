import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { Skeleton } from '../src/components/ui/Skeleton.tsx';

test('Skeleton.List renders card stack and table placeholders', () => {
  render(<Skeleton.List rows={3} columnWidths={['30%', '70%']} />);
  expect(screen.getByTestId('skeleton-card-stack')).toBeInTheDocument();
  expect(screen.getAllByLabelText('Loading content').length).toBeGreaterThanOrEqual(2);
});
