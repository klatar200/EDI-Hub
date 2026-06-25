/**
 * Desktop track D4 Sprint 3 — splash / progress screen.
 *
 * Opens before any boot work begins, so the user sees the app responding
 * within ~1 second of double-click. Drives off two modes:
 *
 *   - **First launch** (PG_VERSION missing): step-by-step progress list,
 *     each step transitions pending → running → done as the main process
 *     finishes that phase. A "one-time setup" notice sets the user's
 *     expectation that this launch can take up to a couple of minutes.
 *   - **Subsequent launches**: a plain spinner. Steps are still tracked
 *     internally (handy for debugging) but the UI hides the list — the
 *     visible UX is "loading, won't be long."
 *
 * The splash window is frameless, always-on-top, and renders a tiny
 * data: URL — no preload, no IPC handshake. Updates are pushed via
 * `webContents.executeJavaScript` against a single `window.__setStep`
 * shim that lives in the inline script below. This keeps the splash a
 * single self-contained file with no asset-copy concerns at packaging
 * time (D6 would otherwise need an electron-builder `extraResources`
 * entry).
 */
import { BrowserWindow } from 'electron';

export type SplashStepId = 'postgres' | 'migrate' | 'api' | 'window';
export type SplashStepStatus = 'pending' | 'running' | 'done';

interface SplashStep {
  id: SplashStepId;
  label: string;
  status: SplashStepStatus;
}

const STEPS: SplashStep[] = [
  { id: 'postgres', label: 'Setting up database', status: 'pending' },
  { id: 'migrate', label: 'Running migrations', status: 'pending' },
  { id: 'api', label: 'Starting server', status: 'pending' },
  { id: 'window', label: 'Loading dashboard', status: 'pending' },
];

let splashWindow: BrowserWindow | null = null;
let firstLaunchActive = false;

function renderHtml(firstLaunch: boolean): string {
  // The CSS lives inline so the splash is one self-contained data: URL —
  // no font/asset fetch over the network, no FOUC. The colors mirror the
  // dark-mode tokens used by the main React app so the transition
  // doesn't flash.
  const stepsJson = JSON.stringify(STEPS);
  const firstLaunchBlock = firstLaunch
    ? `<div class="first-launch-note">This only happens once and usually takes under 2 minutes.</div>`
    : '';
  const body = firstLaunch
    ? `<ul class="steps" id="steps"></ul>`
    : `<div class="spinner-only" role="status" aria-label="Loading"></div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>EDI Hub</title>
<style>
  :root {
    --bg: #0f172a;
    --fg: #f8fafc;
    --muted: #94a3b8;
    --accent: #818cf8;
    --ok: #34d399;
    --border: #1e293b;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); color: var(--fg); font: 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px; user-select: none; cursor: default; }
  h1 { font-size: 18px; margin: 0 0 4px; letter-spacing: 0.2px; font-weight: 600; }
  .subtitle { font-size: 12px; color: var(--muted); margin-bottom: 20px; }
  .first-launch-note { font-size: 12px; color: var(--muted); margin: 0 0 20px; text-align: center; max-width: 320px; line-height: 1.5; }
  ul.steps { list-style: none; margin: 0; padding: 0; width: 280px; }
  ul.steps li { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; transition: color 0.15s; }
  .icon { width: 14px; height: 14px; flex: 0 0 14px; display: inline-block; position: relative; }
  .icon.pending { border: 1.5px solid var(--border); border-radius: 50%; }
  .icon.running { border: 1.5px solid var(--accent); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
  .icon.done::after { content: ""; position: absolute; left: 3px; top: 0; width: 5px; height: 9px; border: solid var(--ok); border-width: 0 2px 2px 0; transform: rotate(45deg); }
  li.pending .label { color: var(--muted); }
  li.running .label { color: var(--fg); }
  li.done .label { color: var(--muted); }
  .spinner-only { width: 32px; height: 32px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin-top: 4px; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <h1>EDI Hub</h1>
  <div class="subtitle">Starting up...</div>
  ${firstLaunchBlock}
  ${body}
  <script>
    const steps = ${stepsJson};
    function render() {
      const ul = document.getElementById('steps');
      if (!ul) return;
      ul.innerHTML = steps.map(function (s) {
        return '<li class="' + s.status + '">' +
          '<span class="icon ' + s.status + '"></span>' +
          '<span class="label">' + s.label + '</span>' +
          '</li>';
      }).join('');
    }
    window.__setStep = function (id, status) {
      var s = steps.find(function (x) { return x.id === id; });
      if (s) s.status = status;
      render();
    };
    render();
  </script>
</body>
</html>`;
}

/**
 * Open the splash window. `firstLaunch` controls which UI the splash
 * shows (step list vs. spinner).
 */
export function openSplash(firstLaunch: boolean): BrowserWindow {
  firstLaunchActive = firstLaunch;
  splashWindow = new BrowserWindow({
    width: 420,
    height: firstLaunch ? 340 : 220,
    frame: false,
    resizable: false,
    show: true,
    alwaysOnTop: true,
    center: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  // Encode the HTML as a base64 data URL. Plain `data:text/html,...` would
  // require percent-encoding the entire payload; base64 sidesteps the
  // escaping rules and works the same way on every Chromium version.
  const html = renderHtml(firstLaunch);
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html, 'utf8').toString('base64');
  void splashWindow.loadURL(dataUrl);
  return splashWindow;
}

/**
 * Transition a step's status. No-op when the splash is closed or this
 * is a subsequent (spinner-only) launch — the step list isn't rendered
 * there.
 */
export function updateSplash(id: SplashStepId, status: SplashStepStatus): void {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  if (!firstLaunchActive) return;
  // executeJavaScript returns a promise; we don't care about the result
  // and don't want a rejection to crash the boot path. swallow.
  splashWindow.webContents
    .executeJavaScript(
      `window.__setStep && window.__setStep(${JSON.stringify(id)}, ${JSON.stringify(status)});`,
    )
    .catch(() => undefined);
}

/** Close the splash and release the reference. Safe to call multiple times. */
export function closeSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}
