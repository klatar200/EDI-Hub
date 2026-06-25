import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Load .env from the monorepo root, not apps/web. Keeps a single .env
  // for both the API (dotenv-cli) and the web app (Vite) — see Phase 9
  // CLERK_SETUP.md, which writes VITE_CLERK_PUBLISHABLE_KEY at the root.
  envDir: '../..',
  server: {
    port: 5173,
    // Proxy API calls to the Fastify backend in dev (avoids CORS).
    // D4 Sprint 2 — the API now registers its routes under /api (it
    // serves the React build at / on the same port for the desktop
    // LAN install). The proxy forwards /api/* verbatim instead of
    // rewriting it away, so /api/partners in the renderer hits the
    // real /api/partners route on the API.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
  },
});
