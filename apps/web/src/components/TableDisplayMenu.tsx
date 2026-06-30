/**
 * U4/T3 — per-user column visibility + table density controls.
 *
 * Persists to `UserPreferences.tablePrefs[tableKey]`. Required columns
 * (e.g. PO) stay visible; the menu disables their checkboxes.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TableDensity, UserPreferences } from '@edi/shared';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { Popover } from './ui';

export interface TableColumnDef {
  id: string;
  label: string;
  /** When true the column cannot be hidden (primary identifier). */
  required?: boolean;
}

export type TablePrefsKey = 'lifecycles' | 'transactions';

export function useTableDisplayPrefs(
  tableKey: TablePrefsKey,
  preferences: UserPreferences | undefined,
  columns: readonly TableColumnDef[],
): {
  density: TableDensity;
  hiddenColumns: Set<string>;
  isColumnVisible: (id: string) => boolean;
  visibleColumns: TableColumnDef[];
  toggleColumn: (id: string, visible: boolean) => void;
  setDensity: (density: TableDensity) => void;
  isPending: boolean;
} {
  const qc = useQueryClient();
  const preferencesKey = useTenantQueryKey('preferences');
  const patchM = useMutation({
    mutationFn: (next: UserPreferences) => api.preferences.patch(next),
    onSuccess: () => void qc.invalidateQueries({ queryKey: preferencesKey }),
  });

  const tablePrefs = preferences?.tablePrefs?.[tableKey];
  const density: TableDensity = tablePrefs?.density ?? 'comfortable';
  const hiddenColumns = new Set(tablePrefs?.hiddenColumns ?? []);
  const requiredIds = new Set(columns.filter((c) => c.required).map((c) => c.id));

  function patchTablePrefs(nextEntry: { density?: TableDensity; hiddenColumns?: string[] }): void {
    if (!preferences) return;
    patchM.mutate({
      ...preferences,
      tablePrefs: {
        ...preferences.tablePrefs,
        [tableKey]: nextEntry,
      },
    });
  }

  function toggleColumn(id: string, visible: boolean): void {
    if (requiredIds.has(id) || !preferences) return;
    const next = new Set(hiddenColumns);
    if (visible) next.delete(id);
    else next.add(id);
    patchTablePrefs({
      density,
      hiddenColumns: [...next],
    });
  }

  function setDensity(next: TableDensity): void {
    if (!preferences || next === density) return;
    patchTablePrefs({
      density: next,
      hiddenColumns: [...hiddenColumns],
    });
  }

  const isColumnVisible = (id: string): boolean => requiredIds.has(id) || !hiddenColumns.has(id);
  const visibleColumns = columns.filter((c) => isColumnVisible(c.id));

  return {
    density,
    hiddenColumns,
    isColumnVisible,
    visibleColumns,
    toggleColumn,
    setDensity,
    isPending: patchM.isPending,
  };
}

export function TableDisplayMenu({
  tableKey,
  preferences,
  columns,
}: {
  tableKey: TablePrefsKey;
  preferences: UserPreferences;
  columns: readonly TableColumnDef[];
}): JSX.Element {
  const { density, hiddenColumns, toggleColumn, setDensity, isPending } = useTableDisplayPrefs(
    tableKey,
    preferences,
    columns,
  );

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`table-display-${tableKey}`}>
      <div
        className="inline-flex rounded-md border border-[var(--color-surface-border)] p-0.5"
        role="group"
        aria-label="Table density"
      >
        <button
          type="button"
          data-testid="table-density-comfortable"
          aria-pressed={density === 'comfortable'}
          disabled={isPending}
          className={`rounded px-2 py-1 text-xs font-medium transition ${
            density === 'comfortable'
              ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'
              : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-muted)]'
          }`}
          onClick={() => setDensity('comfortable')}
        >
          Comfortable
        </button>
        <button
          type="button"
          data-testid="table-density-compact"
          aria-pressed={density === 'compact'}
          disabled={isPending}
          className={`rounded px-2 py-1 text-xs font-medium transition ${
            density === 'compact'
              ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'
              : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-muted)]'
          }`}
          onClick={() => setDensity('compact')}
        >
          Compact
        </button>
      </div>

      <Popover>
        <Popover.Trigger asChild>
          <button
            type="button"
            data-testid="table-columns-trigger"
            aria-label="Choose visible table columns"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-surface-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-fg-muted)] transition hover:bg-[var(--color-surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30"
          >
            Columns
          </button>
        </Popover.Trigger>
        <Popover.Content align="end" className="w-52 p-2">
          <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)]">
            Show columns
          </p>
          <ul className="space-y-1">
            {columns.map((col) => {
              const checked = !hiddenColumns.has(col.id);
              return (
                <li key={col.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--color-surface-muted)] ${
                      col.required ? 'cursor-not-allowed opacity-60' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      data-testid={`table-column-toggle-${col.id}`}
                      checked={checked}
                      disabled={col.required || isPending}
                      onChange={(e) => toggleColumn(col.id, e.target.checked)}
                    />
                    {col.label}
                  </label>
                </li>
              );
            })}
          </ul>
        </Popover.Content>
      </Popover>
    </div>
  );
}
