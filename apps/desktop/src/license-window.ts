/**
 * D8 Sprint 1 — blocking license window + Help-menu key entry.
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { LICENSE_PUBLIC_KEY_PEM } from './license-public-key.js';
import {
  evaluateLicenseState,
  validateLicenseKey,
  type LicenseBlockReason,
} from './license.js';
import {
  ensureLicenseFile,
  loadLicenseFile,
  saveLicenseKey,
} from './license-store.js';

const IPC_SUBMIT = 'license:submit-key';

function blockReasonMessage(reason: LicenseBlockReason): string {
  if (reason === 'trial_expired') {
    return (
      'Your 14-day trial has ended. Enter a license key to continue using EDI Hub, ' +
      'or contact support to purchase a subscription.'
    );
  }
  return (
    'Your license has expired. Enter a renewed license key to continue, ' +
    'or contact support.'
  );
}

function licensePageHtml(options: {
  title: string;
  message: string;
  showQuit: boolean;
}): string {
  const quitBtn = options.showQuit
    ? '<button type="button" id="quit">Quit</button>'
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${options.title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #111; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { color: #444; line-height: 1.5; }
    textarea { width: 100%; height: 7rem; margin: 1rem 0; font-family: monospace; }
    .error { color: #b00020; min-height: 1.25rem; }
    .actions { display: flex; gap: 0.75rem; }
    button { padding: 0.5rem 1rem; }
  </style>
</head>
<body>
  <h1>${options.title}</h1>
  <p>${options.message}</p>
  <textarea id="key" placeholder="Paste your license key here"></textarea>
  <div class="error" id="error"></div>
  <div class="actions">
    <button type="button" id="unlock">Unlock</button>
    ${quitBtn}
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const keyEl = document.getElementById('key');
    const errEl = document.getElementById('error');
    document.getElementById('unlock').onclick = async () => {
      errEl.textContent = '';
      const result = await ipcRenderer.invoke('${IPC_SUBMIT}', keyEl.value);
      if (!result.ok) errEl.textContent = result.error || 'Invalid license key.';
    };
    const quitBtn = document.getElementById('quit');
    if (quitBtn) quitBtn.onclick = () => window.close();
  </script>
</body>
</html>`;
}

async function promptForLicenseKey(options: {
  title: string;
  message: string;
  allowCancel: boolean;
  validateAccepted: (key: string) => { ok: true } | { ok: false; error: string };
}): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler(IPC_SUBMIT);
      if (!win.isDestroyed()) win.close();
      resolve(value);
    };

    ipcMain.handle(IPC_SUBMIT, (_event, rawKey: unknown) => {
      const key = typeof rawKey === 'string' ? rawKey.trim() : '';
      if (!key) return { ok: false, error: 'Enter a license key.' };
      const format = validateLicenseKey(key, LICENSE_PUBLIC_KEY_PEM);
      if (!format.ok) return format;
      const accepted = options.validateAccepted(key);
      if (!accepted.ok) return accepted;
      finish(key);
      return { ok: true };
    });

    const win = new BrowserWindow({
      width: 520,
      height: 420,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });
    win.setMenu(null);
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      if (!settled) finish(null);
    });
    void win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        licensePageHtml({
          title: options.title,
          message: options.message,
          showQuit: options.allowCancel,
        }),
      )}`,
    );
  });
}

/**
 * Gate app startup. Returns false when the user quits from the blocking screen.
 * Fail-open: I/O or evaluation errors log and return true.
 */
export async function enforceLicenseGate(userDataDir: string): Promise<boolean> {
  if (!app.isPackaged || process.env.EDI_SKIP_LICENSE === '1') {
    console.log('[edi-hub] license: skipped (dev or EDI_SKIP_LICENSE=1)');
    return true;
  }

  try {
    const now = new Date();
    let file = ensureLicenseFile(userDataDir, now);

    for (;;) {
      const evaluation = evaluateLicenseState({
        now,
        firstLaunchAt: file.firstLaunchAt,
        licenseKey: file.licenseKey ?? null,
        publicKeyPem: LICENSE_PUBLIC_KEY_PEM,
      });

      if (evaluation.kind !== 'blocked') {
        if (evaluation.kind === 'allowed' && evaluation.renewalWarning) {
          const { renewsAt, daysRemaining } = evaluation.renewalWarning;
          await dialog.showMessageBox({
            type: 'warning',
            title: 'License renewal',
            message: 'Your EDI Hub license is due for renewal soon.',
            detail:
              `Your license renews on ${renewsAt} (${daysRemaining} day(s) remaining). ` +
              'Contact support to renew before access is restricted.',
            buttons: ['OK'],
          });
        }
        return true;
      }

      const key = await promptForLicenseKey({
        title: 'License required',
        message: blockReasonMessage(evaluation.reason),
        allowCancel: true,
        validateAccepted: (candidate) => {
          const post = evaluateLicenseState({
            now,
            firstLaunchAt: file.firstLaunchAt,
            licenseKey: candidate,
            publicKeyPem: LICENSE_PUBLIC_KEY_PEM,
          });
          if (post.kind === 'blocked') {
            return { ok: false, error: blockReasonMessage(post.reason) };
          }
          return { ok: true };
        },
      });
      if (!key) return false;
      file = saveLicenseKey(userDataDir, key, now);
    }
  } catch (err) {
    console.error('[edi-hub] license check failed (fail-open):', err);
    await dialog.showMessageBox({
      type: 'warning',
      title: 'License check unavailable',
      message: 'EDI Hub could not verify your license.',
      detail:
        (err instanceof Error ? err.message : String(err)) +
        '\n\nThe app will start anyway. Contact support if this persists.',
      buttons: ['Continue'],
    });
    return true;
  }
}

/** Help → Enter License Key */
export async function showEnterLicenseKeyMenu(userDataDir: string): Promise<void> {
  const file = ensureLicenseFile(userDataDir, new Date());
  const key = await promptForLicenseKey({
    title: 'Enter license key',
    message: 'Paste your EDI Hub license key below.',
    allowCancel: true,
    validateAccepted: (candidate) => {
      const post = evaluateLicenseState({
        now: new Date(),
        firstLaunchAt: file.firstLaunchAt,
        licenseKey: candidate,
        publicKeyPem: LICENSE_PUBLIC_KEY_PEM,
      });
      if (post.kind === 'blocked') {
        return { ok: false, error: blockReasonMessage(post.reason) };
      }
      return { ok: true };
    },
  });
  if (!key) return;
  saveLicenseKey(userDataDir, key, new Date());
  await dialog.showMessageBox({
    type: 'info',
    title: 'License updated',
    message: 'Your license key has been saved.',
    detail: 'Restart EDI Hub if you were previously blocked.',
    buttons: ['OK'],
  });
}

export function trialDaysRemaining(userDataDir: string, now: Date): number | null {
  const file = loadLicenseFile(userDataDir);
  if (!file || file.licenseKey) return null;
  const first = new Date(file.firstLaunchAt);
  const elapsed = (now.getTime() - first.getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(14 - elapsed));
}
