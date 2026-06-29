/**
 * Content-Security-Policy for the production SPA.
 *
 * Injected at Vite build time (meta tag) and on HTML responses from the API
 * static server (desktop / bundled). Clerk loads clerk-js from the Frontend
 * API host — `script-src 'self'` alone blocks it and yields a blank window.
 *
 * @see https://clerk.com/docs/guides/secure/best-practices/csp-headers
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://*.clerk.accounts.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://img.clerk.com",
  "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.accounts.com https://api.clerk.com https://frontend-api.clerk.com https://clerk-telemetry.com https://*.clerk-telemetry.com",
  "frame-src 'self' https://*.clerk.accounts.dev https://*.clerk.accounts.com https://challenges.cloudflare.com",
  "font-src 'self' https://fonts.gstatic.com",
  "worker-src 'self' blob:",
].join('; ');
