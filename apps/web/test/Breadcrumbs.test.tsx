import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Breadcrumbs } from '../src/components/ui/Breadcrumbs.tsx';

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('collapses middle crumbs on narrow viewports', () => {
  render(
    <MemoryRouter>
      <Breadcrumbs
        items={[
          { to: '/lifecycles', label: 'Lifecycles' },
          { to: '/lifecycles/1', label: 'PO-100' },
          { label: '850 detail' },
        ]}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText('Lifecycles')).toBeInTheDocument();
  expect(screen.getByText('…')).toBeInTheDocument();
  expect(screen.getByText('850 detail')).toBeInTheDocument();
  expect(screen.queryByText('PO-100')).not.toBeInTheDocument();
});
