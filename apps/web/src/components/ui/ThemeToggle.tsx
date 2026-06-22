/**
 * UI Phase Sprint 1 — Theme toggle.
 *
 * Three-position segmented control: light / system / dark. The current
 * resolved theme drives the active style; the user's stored MODE
 * (which may be 'system') drives which segment is pressed.
 *
 * No icon library dependency — small inline SVGs keep the bundle thin.
 */
import { useTheme, type ThemeMode } from '../../lib/useTheme.tsx';

interface SegmentProps {
  mode: ThemeMode;
  active: boolean;
  label: string;
  onSelect: (mode: ThemeMode) => void;
  children: React.ReactNode;
}

function Segment({ mode, active, label, onSelect, children }: SegmentProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={() => onSelect(mode)}
      className={`grid h-6 w-6 place-items-center rounded transition ${
        active
          ? 'bg-[var(--color-surface-card)] text-[var(--color-fg)] shadow-xs'
          : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-muted)]'
      }`}
    >
      {children}
    </button>
  );
}

export function ThemeToggle(): JSX.Element {
  const { mode, setMode } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="flex items-center gap-0.5 rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-muted)] p-0.5"
    >
      <Segment mode="light" active={mode === 'light'} label="Light theme" onSelect={setMode}>
        {/* Sun */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      </Segment>
      <Segment mode="system" active={mode === 'system'} label="System theme" onSelect={setMode}>
        {/* Monitor */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      </Segment>
      <Segment mode="dark" active={mode === 'dark'} label="Dark theme" onSelect={setMode}>
        {/* Moon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </Segment>
    </div>
  );
}
