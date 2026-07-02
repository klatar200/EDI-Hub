/**
 * U4/N4 — Command palette (Cmd-K).
 *
 * A modal overlay that lets the operator fuzzy-jump to any page, action,
 * PO lifecycle, transaction, or raw file without leaving the keyboard.
 *
 * Sources:
 *   - **Pages** — static list of primary destinations (Lifecycles,
 *     Dashboard, Alerts, Documents, Partners, Settings, etc.). Filtered
 *     by substring against the query.
 *   - **Search results** — when the operator has typed something, debounce
 *     and call the existing /search endpoint. Returns lifecycle (PO)
 *     hits, parsed transactions, and raw files. Selecting one navigates
 *     to its detail page.
 *
 * Keyboard contract:
 *   - **Cmd+K / Ctrl+K** anywhere in the app opens the palette (registered
 *     by `useCommandPaletteHotkey` in Layout.tsx).
 *   - **Esc** closes (via the native <dialog> close event).
 *   - **ArrowUp / ArrowDown** moves selection; wraps at both ends.
 *   - **Enter** activates the selected item.
 *
 * Behavior choices:
 *   - Empty query → only static Pages render (no API call). Recent items
 *     are a future feature (would need preferences write-through).
 *   - Non-empty query → static Pages filter inline + a debounced /search
 *     call populates the dynamic sections.
 *   - We mount one palette at the Layout level so the hotkey works on
 *     every authenticated page.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { LifecycleSearchHit, RawFileRecord, TransactionSummary } from '@edi/shared';
import { api } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { useApiReady } from '../lib/useRole.tsx';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/** A page / action item — static, navigates to a fixed route. */
interface PageItem {
  kind: 'page';
  label: string;
  hint?: string;
  to: string;
  /** Lowercased haystack for substring filter. Precomputed at module load. */
  haystack: string;
}

const PAGES: PageItem[] = [
  { kind: 'page', label: 'Lifecycles',           hint: 'PO conversations',                 to: '/lifecycles',      haystack: 'lifecycles po conversations' },
  { kind: 'page', label: 'Dashboard',            hint: 'Monitoring',                       to: '/dashboard',       haystack: 'dashboard monitoring home' },
  { kind: 'page', label: 'Alerts',               hint: 'Open + acknowledged',              to: '/alerts',          haystack: 'alerts missing ack rejection spike' },
  { kind: 'page', label: 'Documents · parsed',   hint: 'Decoded transactions',             to: '/documents?view=parsed', haystack: 'documents transactions parsed' },
  { kind: 'page', label: 'Documents · raw',      hint: 'Received files',                   to: '/documents?view=raw',    haystack: 'documents ingestions received raw files' },
  { kind: 'page', label: 'Partners',             hint: 'Trading partner config',           to: '/partners-config', haystack: 'partners trading partner config' },
  { kind: 'page', label: 'Channels',             hint: 'Connectivity + health',            to: '/channels',        haystack: 'channels connectivity health' },
  { kind: 'page', label: 'Metrics',              hint: 'Rejection rate + traffic',         to: '/metrics',         haystack: 'metrics rejection rate traffic' },
  { kind: 'page', label: 'Settings',             hint: 'Personal + tenant settings',       to: '/settings',        haystack: 'settings preferences' },
  { kind: 'page', label: 'Help',                 hint: 'Docs + glossary',                  to: '/help',            haystack: 'help docs glossary' },
];

interface LifecycleResult { kind: 'lifecycle'; hit: LifecycleSearchHit }
interface TransactionResult { kind: 'transaction'; tx: TransactionSummary }
interface RawFileResult { kind: 'raw'; file: RawFileRecord }
type DynamicResult = LifecycleResult | TransactionResult | RawFileResult;
type CommandItem = PageItem | DynamicResult;

function pageMatches(p: PageItem, q: string): boolean {
  if (!q) return true;
  return p.haystack.includes(q);
}

/** Lifecycle hit → navigation target. Re-uses the PB-8 entry-kind link
 *  (invoice / shipment) so the lifecycle page enters the way it did when
 *  the operator searched. */
function lifecycleTarget(h: LifecycleSearchHit): string {
  const kind = h.entryKind ?? 'po';
  const value = h.entryValue ?? h.po;
  if (kind === 'po') return `/lifecycle/${encodeURIComponent(h.po)}`;
  return `/lifecycle/${encodeURIComponent(h.po)}?${kind}=${encodeURIComponent(value)}`;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps): JSX.Element {
  const navigate = useNavigate();
  const apiReady = useApiReady();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rawQuery, setRawQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Native <dialog> open/close — same pattern as the Modal primitive.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Reset state on close so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setRawQuery('');
      setDebouncedQuery('');
      setSelectedIndex(0);
    } else {
      // Focus the input on open. The native dialog focus heuristic does
      // not always land on the right element when contents are dynamic.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Bridge native close (Esc / backdrop) to the React close handler.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    function onCloseEvent(): void { onClose(); }
    el.addEventListener('close', onCloseEvent);
    return () => el.removeEventListener('close', onCloseEvent);
  }, [onClose]);

  // Debounce the query so we don't hammer /search on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(rawQuery.trim().toLowerCase()), 180);
    return () => clearTimeout(t);
  }, [rawQuery]);

  // Static page list, filtered by the (live, not debounced) query for
  // instant feel. The query is normalized once.
  const liveQuery = rawQuery.trim().toLowerCase();
  const pageItems = useMemo(() => PAGES.filter((p) => pageMatches(p, liveQuery)), [liveQuery]);

  // Dynamic /search call. Only runs when there's a non-trivial query.
  // The PO search resolves by exact match server-side (per PS-10), so a
  // 2-character minimum cuts pointless requests for the first key.
  const searchKey = useTenantQueryKey('palette-search', debouncedQuery);
  const searchQ = useQuery({
    queryKey: searchKey,
    queryFn: () => api.search(debouncedQuery),
    enabled: apiReady && open && debouncedQuery.length >= 2,
    staleTime: 30_000,
    retry: false,
  });

  const lifecycleItems: LifecycleResult[] = (searchQ.data?.lifecycles ?? []).map((hit) => ({ kind: 'lifecycle', hit }));
  const transactionItems: TransactionResult[] = (searchQ.data?.transactions ?? []).map((tx) => ({ kind: 'transaction', tx }));
  const rawFileItems: RawFileResult[] = (searchQ.data?.rawFiles ?? []).map((file) => ({ kind: 'raw', file }));

  // Flat list used for keyboard nav. The visual layout below groups by
  // section but selectedIndex addresses the flat order.
  const flatItems: CommandItem[] = [
    ...pageItems,
    ...lifecycleItems,
    ...transactionItems,
    ...rawFileItems,
  ];

  // Clamp the selected index when the result set shrinks (e.g. typing
  // narrows pageItems out from under the selection).
  useEffect(() => {
    if (selectedIndex >= flatItems.length) setSelectedIndex(0);
  }, [flatItems.length, selectedIndex]);

  function activate(item: CommandItem): void {
    if (item.kind === 'page') {
      navigate(item.to);
    } else if (item.kind === 'lifecycle') {
      navigate(lifecycleTarget(item.hit));
    } else if (item.kind === 'transaction') {
      navigate(`/transactions/${encodeURIComponent(item.tx.id)}`);
    } else if (item.kind === 'raw') {
      // Raw files don't have a detail page yet — jump to the raw-file
      // entry in the Documents (raw) view, scoped by ISA control if known.
      const isa = item.file.isaControlNumber ?? '';
      navigate(isa ? `/documents?view=raw&isa=${encodeURIComponent(isa)}` : '/documents?view=raw');
    }
    onClose();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatItems.length === 0) return;
      setSelectedIndex((i) => (i + 1) % flatItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatItems.length === 0) return;
      setSelectedIndex((i) => (i - 1 + flatItems.length) % flatItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[selectedIndex];
      if (item) activate(item);
    }
  }

  function onBackdropClick(e: React.MouseEvent<HTMLDialogElement>): void {
    // Same pattern as Modal — clicking the dialog element itself (not its
    // content) closes via the native close API.
    if (e.target === dialogRef.current) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClick={onBackdropClick}
      aria-label="Command palette"
      data-testid="command-palette"
      className="m-0 w-[calc(100vw-2rem)] max-h-[90dvh] overflow-hidden rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] p-0 text-[var(--color-fg)] shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm sm:w-full sm:max-w-xl"
    >
      <div onKeyDown={onKeyDown}>
        <div className="border-b border-[var(--color-surface-border)] px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={rawQuery}
            onChange={(e) => { setRawQuery(e.target.value); setSelectedIndex(0); }}
            placeholder="Jump to a page, PO, invoice, or ISA control # (file ID)…"
            className="w-full bg-transparent text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:outline-none"
            data-testid="command-palette-input"
            aria-label="Command palette search"
            aria-autocomplete="list"
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-1" role="listbox" aria-label="Command results">
          {/* Pages section — always present (filtered by live query). */}
          {pageItems.length > 0 ? (
            <Section title="Pages">
              {pageItems.map((p, i) => (
                <PaletteRow
                  key={`page-${p.to}`}
                  index={i}
                  selectedIndex={selectedIndex}
                  setSelectedIndex={setSelectedIndex}
                  onActivate={() => activate(p)}
                  label={p.label}
                  hint={p.hint}
                  testId={`palette-page-${p.to.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`}
                />
              ))}
            </Section>
          ) : null}

          {/* Dynamic sections — lifecycles, transactions, raw files. */}
          {lifecycleItems.length > 0 ? (
            <Section title="Lifecycles">
              {lifecycleItems.map((r, i) => {
                const flatIdx = pageItems.length + i;
                const partner = r.hit.partnerDisplayName ?? '—';
                return (
                  <PaletteRow
                    key={`lifecycle-${r.hit.po}`}
                    index={flatIdx}
                    selectedIndex={selectedIndex}
                    setSelectedIndex={setSelectedIndex}
                    onActivate={() => activate(r)}
                    label={`PO ${r.hit.po}`}
                    hint={`${partner} · ${r.hit.openAlertCount} open alert${r.hit.openAlertCount === 1 ? '' : 's'}`}
                    testId="palette-lifecycle"
                  />
                );
              })}
            </Section>
          ) : null}

          {transactionItems.length > 0 ? (
            <Section title="Transactions">
              {transactionItems.map((r, i) => {
                const flatIdx = pageItems.length + lifecycleItems.length + i;
                return (
                  <PaletteRow
                    key={`tx-${r.tx.id}`}
                    index={flatIdx}
                    selectedIndex={selectedIndex}
                    setSelectedIndex={setSelectedIndex}
                    onActivate={() => activate(r)}
                    label={`${r.tx.transactionSetId} · ${r.tx.controlNumber}`}
                    hint={r.tx.poNumber ? `PO ${r.tx.poNumber}` : r.tx.invoiceNumber ? `Invoice ${r.tx.invoiceNumber}` : r.tx.senderId ?? ''}
                    testId="palette-transaction"
                  />
                );
              })}
            </Section>
          ) : null}

          {rawFileItems.length > 0 ? (
            <Section title="Raw files">
              {rawFileItems.map((r, i) => {
                const flatIdx = pageItems.length + lifecycleItems.length + transactionItems.length + i;
                return (
                  <PaletteRow
                    key={`raw-${r.file.id}`}
                    index={flatIdx}
                    selectedIndex={selectedIndex}
                    setSelectedIndex={setSelectedIndex}
                    onActivate={() => activate(r)}
                    label={r.file.isaControlNumber ? `ISA ${r.file.isaControlNumber}` : `Raw ${r.file.id.slice(0, 8)}…`}
                    hint={r.file.status}
                    testId="palette-raw"
                  />
                );
              })}
            </Section>
          ) : null}

          {/* States: no matches at all, or a non-trivial query in flight. */}
          {flatItems.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-[var(--color-fg-muted)]">
              {searchQ.isLoading
                ? 'Searching…'
                : debouncedQuery && debouncedQuery.length < 2
                  ? 'Keep typing to search records.'
                  : 'No matches.'}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-surface-border)] px-3 py-1.5 text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
          <span><kbd className="font-mono">↑↓</kbd> navigate · <kbd className="font-mono">↵</kbd> select · <kbd className="font-mono">esc</kbd> close</span>
          {searchQ.isFetching ? <span data-testid="palette-fetching">Searching…</span> : null}
        </div>
      </div>
    </dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Internal layout helpers
// ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="px-1 py-1">
      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)]">
        {title}
      </p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function PaletteRow({
  index,
  selectedIndex,
  setSelectedIndex,
  onActivate,
  label,
  hint,
  testId,
}: {
  index: number;
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
  onActivate: () => void;
  label: string;
  hint?: string;
  testId?: string;
}): JSX.Element {
  const isSelected = index === selectedIndex;
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={isSelected}
        data-testid={testId}
        onMouseEnter={() => setSelectedIndex(index)}
        onClick={onActivate}
        className={`flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm transition ${
          isSelected
            ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'
            : 'text-[var(--color-fg)] hover:bg-[var(--color-surface-muted)]'
        }`}
      >
        <span className="truncate">{label}</span>
        {hint ? (
          <span className={`shrink-0 truncate text-xs ${isSelected ? 'text-[var(--color-brand-700)]/80' : 'text-[var(--color-fg-muted)]'}`}>
            {hint}
          </span>
        ) : null}
      </button>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────
// Global Cmd-K hotkey
// ─────────────────────────────────────────────────────────────

/** Hook that returns [open, setOpen] for the palette and wires the
 *  Cmd+K / Ctrl+K hotkey to open it. Mounting the listener once at the
 *  Layout level keeps the hotkey live on every authenticated page. */
export function useCommandPaletteHotkey(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // Use the DOM KeyboardEvent type explicitly so it doesn't collide
    // with the React `KeyboardEvent` imported above.
    function onKeyDown(e: globalThis.KeyboardEvent): void {
      // `metaKey` covers Cmd on macOS; `ctrlKey` covers everything else.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  return [open, setOpen];
}
