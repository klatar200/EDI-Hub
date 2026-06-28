/**
 * PS-10 — saved filter views + pin controls for LifecyclesPage.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SavedView, UserPreferences } from '@edi/shared';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { FormField, Input, Select } from './ui';

const MAX_PINS = 10;
const MAX_SAVED_VIEWS = 20;

export function sortWithPinnedPos<T extends { po: string }>(items: T[], pinnedPos: string[]): T[] {
  const pinIndex = new Map(pinnedPos.map((po, i) => [po, i]));
  return [...items].sort((a, b) => {
    const ai = pinIndex.get(a.po);
    const bi = pinIndex.get(b.po);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return 0;
  });
}

/** Query string for lifecycles filters, excluding page and pinnedOnly. */
export function filtersToViewQuery(sp: URLSearchParams): string {
  const next = new URLSearchParams(sp);
  next.delete('page');
  next.delete('pinnedOnly');
  return next.toString();
}

export function SavedViewsBar({
  preferences,
  currentQuery,
  pinnedOnly,
  onApplyView,
  onTogglePinnedOnly,
}: {
  preferences: UserPreferences;
  currentQuery: string;
  pinnedOnly: boolean;
  onApplyView: (query: string) => void;
  onTogglePinnedOnly: (enabled: boolean) => void;
}): JSX.Element {
  const qc = useQueryClient();
  const preferencesKey = useTenantQueryKey('preferences');
  const [viewName, setViewName] = useState('');
  const savedViews = preferences.savedViews ?? [];
  const pinnedCount = preferences.pinnedPos?.length ?? 0;

  const patchM = useMutation({
    mutationFn: (next: UserPreferences) => api.preferences.patch(next),
    onSuccess: () => void qc.invalidateQueries({ queryKey: preferencesKey }),
  });

  function saveCurrentView(): void {
    const name = viewName.trim();
    if (!name || !currentQuery) return;
    const views = [...savedViews, { id: crypto.randomUUID(), name, query: currentQuery }].slice(-MAX_SAVED_VIEWS);
    patchM.mutate({ ...preferences, savedViews: views });
    setViewName('');
  }

  function deleteView(id: string): void {
    patchM.mutate({
      ...preferences,
      savedViews: savedViews.filter((v) => v.id !== id),
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-[var(--color-surface-border)] px-3 py-3" data-testid="saved-views-bar">
      <FormField label="Saved views">
        <Select
          size="sm"
          value=""
          data-testid="saved-view-select"
          onChange={(e) => {
            const view = savedViews.find((v) => v.id === e.target.value);
            if (view) onApplyView(view.query);
            e.target.value = '';
          }}
        >
          <option value="">Load a view…</option>
          {savedViews.map((v: SavedView) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </Select>
      </FormField>
      <FormField label="Save as">
        <Input
          size="sm"
          placeholder="View name"
          value={viewName}
          data-testid="save-view-name"
          onChange={(e) => setViewName(e.target.value)}
        />
      </FormField>
      <button
        type="button"
        className="rounded border border-[var(--color-surface-border)] px-2 py-1 text-sm hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
        data-testid="save-view-btn"
        disabled={!viewName.trim() || !currentQuery || patchM.isPending}
        onClick={saveCurrentView}
      >
        Save view
      </button>
      {savedViews.map((v) => (
        <button
          key={v.id}
          type="button"
          className="rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-border)]"
          data-testid={`delete-view-${v.id}`}
          title={`Delete “${v.name}”`}
          onClick={() => deleteView(v.id)}
        >
          {v.name} ×
        </button>
      ))}
      <FormField label="Pinned">
        <Select
          size="sm"
          value={pinnedOnly ? 'true' : ''}
          data-testid="pinned-only-select"
          disabled={pinnedCount === 0}
          onChange={(e) => onTogglePinnedOnly(e.target.value === 'true')}
        >
          <option value="">All conversations</option>
          <option value="true">Pinned only ({pinnedCount})</option>
        </Select>
      </FormField>
    </div>
  );
}

export function PinButton({
  po,
  pinned,
  onToggle,
  disabled,
}: {
  po: string;
  pinned: boolean;
  onToggle: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={pinned ? `Unpin ${po}` : `Pin ${po}`}
      aria-pressed={pinned}
      data-testid={`pin-${po}`}
      className={`mr-1 text-sm ${pinned ? 'text-[var(--color-warn-600)]' : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-warn-500)]'} disabled:opacity-50`}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        onToggle();
      }}
    >
      {pinned ? '★' : '☆'}
    </button>
  );
}

export function usePinToggle(preferences: UserPreferences | undefined) {
  const qc = useQueryClient();
  const preferencesKey = useTenantQueryKey('preferences');
  const patchM = useMutation({
    mutationFn: (next: UserPreferences) => api.preferences.patch(next),
    onSuccess: () => void qc.invalidateQueries({ queryKey: preferencesKey }),
  });

  function togglePin(po: string): void {
    const pinned = preferences?.pinnedPos ?? [];
    const isPinned = pinned.includes(po);
    let nextPins: string[];
    if (isPinned) {
      nextPins = pinned.filter((p) => p !== po);
    } else if (pinned.length >= MAX_PINS) {
      return;
    } else {
      nextPins = [...pinned, po];
    }
    patchM.mutate({ ...preferences, pinnedPos: nextPins });
  }

  return { togglePin, isPending: patchM.isPending };
}
