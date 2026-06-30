import type { TablePrefsKey } from '../components/TableDisplayMenu.tsx';

/** UR2/R17 — columns hidden by default below `lg` (not persisted to user prefs). */
export const RESPONSIVE_HIDDEN_COLUMNS: Partial<Record<TablePrefsKey, readonly string[]>> = {
  lifecycles: ['flow', 'due', 'flags'],
  transactions: ['sender', 'receiver', 'direction'],
};

export function mergeResponsiveHiddenColumns(
  tableKey: TablePrefsKey,
  userHidden: Iterable<string>,
  belowLg: boolean,
): Set<string> {
  const merged = new Set(userHidden);
  if (belowLg) {
    for (const id of RESPONSIVE_HIDDEN_COLUMNS[tableKey] ?? []) {
      merged.add(id);
    }
  }
  return merged;
}
