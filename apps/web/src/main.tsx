/**
 * Web app entry.
 *
 * Wraps the React tree in:
 *  - ClerkProvider: hosts the Clerk session. With `@clerk/react` on Vite,
 *    we MUST pass `publishableKey` explicitly — unlike Clerk's Next.js
 *    integration, the React-only SDK does not auto-read env vars at the
 *    provider boundary. Forgetting this is a silent white screen.
 *  - QueryClientProvider: shared TanStack Query cache.
 *  - BrowserRouter: react-router-dom routing.
 *
 * If `VITE_CLERK_PUBLISHABLE_KEY` is missing we render a banner instead
 * of mounting ClerkProvider with `undefined` — the banner is the fastest
 * possible signal that env setup is incomplete (see BUILD_PLAN.md §11).
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider } from '@clerk/react';
import { App } from './App.tsx';
import { ThemeProvider, useTheme } from './lib/useTheme.tsx';
import { ToastProvider } from './lib/useToast.tsx';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function MissingClerkKey(): JSX.Element {
  return (
    <div className="m-8 max-w-2xl rounded-lg border border-[var(--color-warn-500)]/30 bg-[var(--color-warn-50)] p-6 text-sm text-[var(--color-warn-700)]">
      <h1 className="mb-2 text-base font-semibold">VITE_CLERK_PUBLISHABLE_KEY is not set</h1>
      <p className="mb-2">
        The Clerk publishable key is required for the web app to render. Add it to
        <code className="mx-1 rounded bg-[var(--color-warn-500)]/15 px-1 py-0.5 font-mono">.env</code>
        at the repo root and restart <code>npm run dev</code>.
      </p>
      <p>See <code>BUILD_PLAN.md</code> §11 (Clerk setup) for the full walkthrough.</p>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);

if (!clerkKey || clerkKey.startsWith('REPLACE_ME') || clerkKey === 'pk_test_...') {
  // Catch both "unset" and "still placeholder" with one guard. The
  // placeholder check matches the value we ship in the .env template.
  root.render(<MissingClerkKey />);
} else {
  // Clerk's hosted UI doesn't auto-follow our theme — wrap ClerkProvider
  // in a small component that reads our resolved theme and applies a
  // matching baseTheme. Keeps the sign-in card + UserButton dropdown
  // visually consistent in dark mode.
  function ThemedClerk({ children }: { children: React.ReactNode }): JSX.Element {
    const { resolved } = useTheme();
    return (
      <ClerkProvider
        publishableKey={clerkKey!}
        afterSignOutUrl="/"
        appearance={{
          variables: {
            colorPrimary: 'oklch(0.55 0.22 282)', // brand-500
            colorBackground: resolved === 'dark' ? 'oklch(0.18 0.012 260)' : 'oklch(1 0 0)',
            // Clerk's `Variables` type renamed `colorText` to
            // `colorTextOnPrimaryBackground` / `colorNeutral` in @clerk/react v0.x.
            // Drop until we re-survey the new theming surface — defaults
            // already adapt to the appearance baseTheme.
          },
        }}
      >
        {children}
      </ClerkProvider>
    );
  }

  root.render(
    <React.StrictMode>
      <ThemeProvider>
        <ThemedClerk>
          <QueryClientProvider client={queryClient}>
            {/* ToastProvider lives BELOW QueryClient so mutation callbacks can
                fire success/error toasts via useToast(). Above BrowserRouter
                so the viewport persists across route changes. */}
            <ToastProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </ToastProvider>
          </QueryClientProvider>
        </ThemedClerk>
      </ThemeProvider>
    </React.StrictMode>,
  );
}
