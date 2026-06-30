/**
 * UR7/R57 — keyboard shortcuts discoverability overlay.
 *
 * `?` opens a modal listing global shortcuts. Also wired to a header
 * button beside the command-palette trigger.
 */
import { useEffect } from 'react';
import { Modal } from './ui';
import { HEADER_SEARCH_INPUT_ID, isEditableTarget, modKeyLabel } from '../lib/keyboard.ts';

export { HEADER_SEARCH_INPUT_ID };

interface ShortcutRow {
  keys: string[];
  description: string;
}

function ShortcutKeys({ keys }: { keys: string[] }): JSX.Element {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k, i) => (
        <kbd
          key={`${k}-${i}`}
          className="rounded border border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-fg-muted)]"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

interface KeyboardShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsOverlay({
  open,
  onClose,
}: KeyboardShortcutsOverlayProps): JSX.Element {
  const mod = modKeyLabel();
  const shortcuts: ShortcutRow[] = [
    { keys: [mod, 'K'], description: 'Open command palette (jump to pages & search)' },
    { keys: ['/'], description: 'Focus header search' },
    { keys: ['?'], description: 'Show this shortcuts list' },
    { keys: ['Esc'], description: 'Close modal, drawer, or popover' },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <Modal.Body className="py-3">
        <ul className="divide-y divide-[var(--color-surface-border)]" data-testid="keyboard-shortcuts-list">
          {shortcuts.map((row) => (
            <li key={row.description} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
              <span className="text-sm text-[var(--color-fg-muted)]">{row.description}</span>
              <ShortcutKeys keys={row.keys} />
            </li>
          ))}
        </ul>
      </Modal.Body>
    </Modal>
  );
}

interface GlobalHotkeyOptions {
  onOpenShortcuts: () => void;
  searchInputId?: string;
}

/** Registers `/` (focus search) and `?` (shortcuts overlay) at the Layout level. */
export function useGlobalKeyboardHotkeys({
  onOpenShortcuts,
  searchInputId = HEADER_SEARCH_INPUT_ID,
}: GlobalHotkeyOptions): void {
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent): void {
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '?') {
        e.preventDefault();
        onOpenShortcuts();
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        const el = document.getElementById(searchInputId);
        if (el instanceof HTMLInputElement) {
          el.focus();
          el.select();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpenShortcuts, searchInputId]);
}
