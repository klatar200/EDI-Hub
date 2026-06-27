/**
 * UI Phase Sprint 1 — Theme provider.
 *
 * Three modes:
 *   - 'light'  always light
 *   - 'dark'   always dark
 *   - 'system' follows prefers-color-scheme
 *
 * Persists the user's choice in localStorage under 'edi-hub:theme'. On
 * mount we resolve to the effective scheme and toggle `class="dark"` on
 * <html>. All token overrides in index.css key off that class.
 *
 * No external dependency. Hook is read by ThemeToggle in the header.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'edi-hub:theme';

function readStored(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === 'light' || v === 'dark' || v === 'system') return v;
  return 'system';
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

function applyToDocument(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (resolved === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [mode, setModeState] = useState<ThemeMode>(() => readStored());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readStored()));

  // Apply to <html> on every resolved-theme change.
  useEffect(() => {
    applyToDocument(resolved);
  }, [resolved]);

  // Re-resolve when mode changes OR when the OS preference changes (only
  // matters when mode === 'system').
  useEffect(() => {
    setResolved(resolve(mode));
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage might be disabled (private mode / sandboxed iframe).
      // Theme still works for this session via the React state.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Defensive default — components rendered outside <ThemeProvider>
    // (storybook, isolated tests) get a no-op theme.
    return {
      mode: 'system',
      resolved: systemPrefersDark() ? 'dark' : 'light',
      setMode: () => undefined,
    };
  }
  return ctx;
}
