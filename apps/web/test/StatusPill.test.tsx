import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { StatusPill } from '../src/components/ui/StatusPill.tsx';

test('StatusPill truncates long labels and exposes title tooltip', () => {
  const longLabel = 'CUSTOM_PARTNER_STATUS_AWAITING_MANUAL_REVIEW';
  render(
    <div className="w-24">
      <StatusPill tone="warn" size="sm">{longLabel}</StatusPill>
    </div>,
  );
  const pill = screen.getByTitle(longLabel);
  expect(pill).toBeInTheDocument();
  expect(pill.querySelector('.truncate')).toBeTruthy();
});
