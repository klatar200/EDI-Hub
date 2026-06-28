/**
 * Content-Security-Policy for the production SPA build.
 * Injected at build time (Vite) and on HTML responses from the API static server.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.clerk.com",
  "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.accounts.com https://api.clerk.com https://frontend-api.clerk.com",
  "frame-src https://*.clerk.accounts.dev https://*.clerk.accounts.com",
  "font-src 'self'",
  "worker-src 'self' blob:",
].join('; ');
