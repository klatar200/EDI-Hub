/**
 * UR4/R27 — persist main window size, position, and maximized state.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const WINDOW_MIN_WIDTH = 960;
export const WINDOW_MIN_HEIGHT = 600;

export interface WindowBoundsFile {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

export const DEFAULT_WINDOW_BOUNDS: WindowBoundsFile = {
  width: 1280,
  height: 800,
};

export function windowBoundsPath(userDataDir: string): string {
  return join(userDataDir, 'window-bounds.json');
}

function clampDimension(value: number, min: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.round(value));
}

/** Normalize persisted bounds for BrowserWindow construction. */
export function normalizeWindowBounds(raw: Partial<WindowBoundsFile> | null | undefined): WindowBoundsFile {
  const width = clampDimension(raw?.width ?? DEFAULT_WINDOW_BOUNDS.width, WINDOW_MIN_WIDTH);
  const height = clampDimension(raw?.height ?? DEFAULT_WINDOW_BOUNDS.height, WINDOW_MIN_HEIGHT);
  const next: WindowBoundsFile = { width, height };
  if (typeof raw?.x === 'number' && Number.isFinite(raw.x)) next.x = Math.round(raw.x);
  if (typeof raw?.y === 'number' && Number.isFinite(raw.y)) next.y = Math.round(raw.y);
  if (raw?.isMaximized === true) next.isMaximized = true;
  return next;
}

export function loadWindowBounds(userDataDir: string): WindowBoundsFile {
  const path = windowBoundsPath(userDataDir);
  if (!existsSync(path)) return { ...DEFAULT_WINDOW_BOUNDS };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<WindowBoundsFile>;
    return normalizeWindowBounds(parsed);
  } catch {
    return { ...DEFAULT_WINDOW_BOUNDS };
  }
}

export function saveWindowBounds(userDataDir: string, bounds: WindowBoundsFile): void {
  const path = windowBoundsPath(userDataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(normalizeWindowBounds(bounds), null, 2)}\n`, 'utf8');
}
