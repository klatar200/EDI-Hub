/** Header search input — shared id for `/` focus hotkey. */
export const HEADER_SEARCH_INPUT_ID = 'header-search-input';

/** True when the event target is an editable field — hotkeys should not steal keys. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/** Modifier label for shortcut hints (⌘ on macOS, Ctrl elsewhere). */
export function modKeyLabel(): string {
  if (typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform)) {
    return '⌘';
  }
  return 'Ctrl';
}
