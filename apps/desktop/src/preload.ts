/**
 * Desktop track D4 Sprint 2 — preload script.
 *
 * Runs in the isolated preload world (`contextIsolation: true`) and
 * exposes one small surface to the renderer:
 *
 *   - `window.runtime` — `{ mode, version, platform }`. The web app
 *     uses `mode === 'desktop'` to render desktop-only UI (the
 *     first-run wizard's folder-picker step, for instance).
 *
 * Sprint 1 also exposed `__EDI_API_BASE__` so the renderer could fetch
 * cross-origin from the API child. Sprint 2 collapses both onto the
 * same port (`http://127.0.0.1:3000`) so api.ts's default `/api` BASE
 * works same-origin without any preload-side override.
 *
 * `contextIsolation: true` means the renderer cannot reach Node
 * primitives directly. That's intentional — the renderer renders
 * untrusted HTML (Clerk-served auth pages, user-supplied EDI content
 * displayed verbatim), and the contextBridge boundary is the line of
 * defense.
 */
import { contextBridge } from 'electron';

const runtime = {
  mode: 'desktop' as const,
  // App version is mirrored via env by the main process at spawn time.
  version: process.env.EDI_DESKTOP_VERSION ?? '0.0.0',
  platform: process.platform,
};

contextBridge.exposeInMainWorld('runtime', runtime);
