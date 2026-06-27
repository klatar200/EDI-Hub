/**
 * PS-12 — shared product URLs for Help menus (web + desktop).
 */
export const RELEASES_URL = 'https://github.com/klatar200/EDI-Hub/releases';
export const CLERK_DASHBOARD_URL = 'https://dashboard.clerk.com';
export const LAN_INSTALL_DOCS_URL =
  'https://github.com/klatar200/EDI-Hub/blob/main/apps/desktop/LAN_INSTALL.md';

/** Pick the best LAN-facing origin from server health redirectOrigins. */
export function preferredLanOrigin(origins: string[]): string {
  if (origins.length === 0) return 'http://127.0.0.1:3000';
  return origins.find((o) => !o.includes('localhost') && !o.includes('127.0.0.1')) ?? origins[0]!;
}
