/**
 * Clerk API credentials bundled at release build time into
 * `process.resourcesPath/clerk-runtime.json`. The Electron main process
 * forwards these to the API child so JWT verification works on the
 * packaged LAN server without a separate `.env` file.
 *
 * When the file is absent (local dev) or keys are blank, the API falls
 * back to pilot-tenant mode — see hub-mode exemptions in assertProductionAuthConfig.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ClerkRuntimeFile {
  publishableKey?: string;
  secretKey?: string;
  webhookSecret?: string;
  authorizedParties?: string;
}

/** Read bundled Clerk env for the API child. Returns only set keys. */
export function loadClerkRuntimeEnv(resourcesPath: string): Record<string, string> {
  const path = join(resourcesPath, 'clerk-runtime.json');
  if (!resourcesPath || !existsSync(path)) return {};

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as ClerkRuntimeFile;
    const env: Record<string, string> = {};
    if (raw.publishableKey?.trim()) env.VITE_CLERK_PUBLISHABLE_KEY = raw.publishableKey.trim();
    if (raw.secretKey?.trim()) env.CLERK_SECRET_KEY = raw.secretKey.trim();
    if (raw.webhookSecret?.trim()) env.CLERK_WEBHOOK_SECRET = raw.webhookSecret.trim();
    if (raw.authorizedParties?.trim()) env.CLERK_AUTHORIZED_PARTIES = raw.authorizedParties.trim();
    return env;
  } catch {
    return {};
  }
}
