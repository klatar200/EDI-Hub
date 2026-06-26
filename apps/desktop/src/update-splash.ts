/**
 * OPTIONAL-D2 — full-screen update gate shown before the normal boot splash.
 *
 * Rendered as a frameless data: URL window (same pattern as splash.ts) so we
 * can show download progress without spinning up the React app first.
 */
import { BrowserWindow } from 'electron';

export type UpdateSplashPhase =
  | 'checking'
  | 'downloading'
  | 'installing'
  | 'error';

let updateWindow: BrowserWindow | null = null;

function renderHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>EDI Hub — Updating</title>
<style>
  :root {
    --bg: #0f172a;
    --fg: #f8fafc;
    --muted: #94a3b8;
    --accent: #818cf8;
    --ok: #34d399;
    --error: #f87171;
    --border: #1e293b;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: var(--bg); color: var(--fg);
    font: 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 32px; user-select: none; cursor: default; text-align: center;
  }
  h1 { font-size: 18px; margin: 0 0 6px; font-weight: 600; }
  .subtitle { font-size: 13px; color: var(--muted); margin-bottom: 20px; max-width: 360px; line-height: 1.5; }
  .version { font-family: ui-monospace, monospace; color: var(--fg); }
  .bar-track {
    width: 300px; height: 8px; border-radius: 999px;
    background: var(--border); overflow: hidden; margin: 8px 0 6px;
  }
  .bar-fill {
    height: 100%; width: 0%; border-radius: 999px;
    background: linear-gradient(90deg, var(--accent), #a5b4fc);
    transition: width 0.2s ease;
  }
  .pct { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; min-height: 18px; }
  .spinner {
    width: 28px; height: 28px; margin: 12px auto 0;
    border: 3px solid var(--border); border-top-color: var(--accent);
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  .error { color: var(--error); font-size: 12px; max-width: 340px; line-height: 1.5; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <h1 id="title">EDI Hub</h1>
  <div class="subtitle" id="message">Checking for updates…</div>
  <div id="progress-block" style="display:none">
    <div class="bar-track"><div class="bar-fill" id="bar"></div></div>
    <div class="pct" id="pct"></div>
  </div>
  <div class="spinner" id="spinner"></div>
  <div class="error" id="error" style="display:none"></div>
  <script>
    window.__setUpdateSplash = function (state) {
      var title = document.getElementById('title');
      var message = document.getElementById('message');
      var progress = document.getElementById('progress-block');
      var bar = document.getElementById('bar');
      var pct = document.getElementById('pct');
      var spinner = document.getElementById('spinner');
      var error = document.getElementById('error');
      if (!title || !message) return;
      title.textContent = state.title || 'EDI Hub';
      message.innerHTML = state.message || '';
      if (state.phase === 'downloading') {
        progress.style.display = 'block';
        spinner.style.display = 'none';
        var p = Math.max(0, Math.min(100, state.percent || 0));
        bar.style.width = p + '%';
        pct.textContent = Math.round(p) + '% downloaded';
      } else if (state.phase === 'installing') {
        progress.style.display = 'none';
        spinner.style.display = 'block';
        pct.textContent = '';
      } else if (state.phase === 'error') {
        progress.style.display = 'none';
        spinner.style.display = 'none';
        error.style.display = 'block';
        error.textContent = state.error || 'Update failed.';
      } else {
        progress.style.display = 'none';
        spinner.style.display = 'block';
        pct.textContent = '';
        error.style.display = 'none';
      }
    };
  </script>
</body>
</html>`;
}

export function openUpdateSplash(): BrowserWindow {
  updateWindow = new BrowserWindow({
    width: 440,
    height: 280,
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
  const dataUrl = 'data:text/html;base64,' + Buffer.from(renderHtml(), 'utf8').toString('base64');
  void updateWindow.loadURL(dataUrl);
  return updateWindow;
}

function pushState(state: {
  phase: UpdateSplashPhase;
  title?: string;
  message?: string;
  percent?: number;
  error?: string;
}): void {
  if (!updateWindow || updateWindow.isDestroyed()) return;
  updateWindow.webContents
    .executeJavaScript(`window.__setUpdateSplash && window.__setUpdateSplash(${JSON.stringify(state)});`)
    .catch(() => undefined);
}

export function setUpdateSplashChecking(currentVersion: string): void {
  pushState({
    phase: 'checking',
    title: 'EDI Hub',
    message: `Checking for updates…<br><span class="version">v${currentVersion}</span>`,
  });
}

export function isUpdateSplashOpen(): boolean {
  return updateWindow !== null && !updateWindow.isDestroyed();
}

export function setUpdateSplashDownloading(
  version: string,
  percent: number,
  hint?: string,
): void {
  const extra = hint ? `<br><span style="color:var(--muted);font-size:12px">${hint}</span>` : '';
  pushState({
    phase: 'downloading',
    title: 'Update available',
    message: `Downloading <span class="version">v${version}</span>…${extra}`,
    percent,
  });
}

export function setUpdateSplashInstalling(version: string): void {
  pushState({
    phase: 'installing',
    title: 'Installing update',
    message:
      `Installing <span class="version">v${version}</span>.<br><br>` +
      'EDI Hub will close and an <strong>installer progress window</strong> will take over. ' +
      'Replacing files can take several minutes — your Start Menu shortcut may not work ' +
      'until it finishes, then EDI Hub will reopen automatically.',
  });
}

export function setUpdateSplashError(message: string): void {
  pushState({
    phase: 'error',
    title: 'Update failed',
    message: 'Could not install the update.',
    error: message,
  });
}

export function closeUpdateSplash(): void {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.close();
  }
  updateWindow = null;
}
