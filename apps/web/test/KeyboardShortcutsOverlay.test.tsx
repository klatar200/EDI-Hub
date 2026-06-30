import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, test, expect, vi } from 'vitest';
import {
  KeyboardShortcutsOverlay,
  useGlobalKeyboardHotkeys,
} from '../src/components/KeyboardShortcutsOverlay.tsx';
import { HEADER_SEARCH_INPUT_ID } from '../src/lib/keyboard.ts';

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      (this as HTMLDialogElement).setAttribute('open', '');
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      const ev = new Event('close');
      this.removeAttribute('open');
      this.dispatchEvent(ev);
    };
  }
});

test('shortcuts overlay lists global hotkeys', () => {
  render(<KeyboardShortcutsOverlay open onClose={vi.fn()} />);
  expect(screen.getByTestId('keyboard-shortcuts-list')).toBeInTheDocument();
  expect(screen.getByText(/Open command palette/i)).toBeInTheDocument();
  expect(screen.getByText(/Focus header search/i)).toBeInTheDocument();
  expect(screen.getByText(/Show this shortcuts list/i)).toBeInTheDocument();
  expect(screen.getByText(/Close modal, drawer, or popover/i)).toBeInTheDocument();
});

function HotkeyProbe({ onOpenShortcuts }: { onOpenShortcuts: () => void }): JSX.Element {
  useGlobalKeyboardHotkeys({ onOpenShortcuts });
  return <input data-testid="editable" />;
}

test('? hotkey calls onOpenShortcuts when not typing in a field', () => {
  const onOpen = vi.fn();
  render(<HotkeyProbe onOpenShortcuts={onOpen} />);
  fireEvent.keyDown(window, { key: '?' });
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test('? hotkey is ignored while focus is in an input', () => {
  const onOpen = vi.fn();
  render(<HotkeyProbe onOpenShortcuts={onOpen} />);
  const input = screen.getByTestId('editable');
  fireEvent.keyDown(input, { key: '?' });
  expect(onOpen).not.toHaveBeenCalled();
});

test('/ hotkey focuses header search input', () => {
  const onOpen = vi.fn();
  render(
    <>
      <input id={HEADER_SEARCH_INPUT_ID} aria-label="Search" />
      <HotkeyProbe onOpenShortcuts={onOpen} />
    </>,
  );
  const search = screen.getByLabelText('Search');
  expect(document.activeElement).not.toBe(search);
  fireEvent.keyDown(window, { key: '/' });
  expect(document.activeElement).toBe(search);
});
