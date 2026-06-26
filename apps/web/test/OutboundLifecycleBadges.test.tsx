import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { OutboundLifecycleBadges } from '../src/components/OutboundStage.tsx';

test('transmitted outbound shows Transmitted then Not Confirmed', () => {
  render(<OutboundLifecycleBadges stage="transmitted" status="received" />);
  expect(screen.getByTestId('stage-badge-transmitted')).toBeInTheDocument();
  expect(screen.getByTestId('confirmation-badge-not-confirmed')).toBeInTheDocument();
  expect(screen.getByText('Not Confirmed')).toBeInTheDocument();
  expect(screen.queryByText('Received')).toBeNull();
});

test('confirmed outbound shows Transmitted then Confirmed', () => {
  render(<OutboundLifecycleBadges stage="confirmed" status="acknowledged" />);
  expect(screen.getByTestId('stage-badge-transmitted')).toBeInTheDocument();
  expect(screen.getByTestId('confirmation-badge-confirmed')).toBeInTheDocument();
  expect(screen.getByText('Confirmed')).toBeInTheDocument();
});

test('rejected outbound keeps Transmitted then Rejected', () => {
  render(<OutboundLifecycleBadges stage="transmitted" status="rejected" />);
  expect(screen.getByTestId('stage-badge-transmitted')).toBeInTheDocument();
  expect(screen.getByText('Rejected')).toBeInTheDocument();
  expect(screen.queryByText('Not Confirmed')).toBeNull();
});
