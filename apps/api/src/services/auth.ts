/**
 * Phase 9 Sprint 2 — Clerk JWT verification.
 *
 * `verifyBearerToken` parses the `Authorization: Bearer <jwt>` header, verifies
 * the JWT against Clerk's JWKS (via @clerk/backend), and returns the claims
 * we care about: the Clerk user id and the active Clerk Organization id.
 *
 * The User row lookup (by clerkUserId + tenantId) lives in the tenant plugin,
 * not here — this module is just JWT plumbing.
 *
 * Dev-mode fallback: when `CLERK_SECRET_KEY` is blank, every verification
 * returns `null`. The tenant plugin treats `null` as "no auth configured,
 * pin to the pilot tenant" so the local dev workflow keeps working without
 * Clerk being set up. Production MUST set the secret key.
 */
import { createClerkClient, type ClerkClient } from '@clerk/backend';
import type { FastifyRequest } from 'fastify';

export interface VerifiedAuth {
  /** Clerk user id, format `user_xxx`. Stable across orgs the user belongs to. */
  clerkUserId: string;
  /** Active Clerk Organization id, format `org_xxx`. The user may belong to
   *  multiple orgs; the JWT's `org_id` claim is the one they're acting as
   *  right now (set by the web app's `<OrganizationSwitcher />`). */
  orgId: string;
}

/** Lazily-built Clerk client, scoped to a secret key + publishable key.
 *  Reused across requests. Publishable key helps the SDK derive the JWKS
 *  endpoint and is required for some token validation paths in
 *  @clerk/backend v1.x. */
let clerk: ClerkClient | undefined;
let clerkSecretKey: string | undefined;
let clerkPublishableKey: string | undefined;

function getClerkClient(secretKey: string, publishableKey?: string): ClerkClient {
  if (!clerk || clerkSecretKey !== secretKey || clerkPublishableKey !== publishableKey) {
    clerk = createClerkClient({ secretKey, publishableKey });
    clerkSecretKey = secretKey;
    clerkPublishableKey = publishableKey;
  }
  return clerk;
}

/** Clerk treats `localhost` and `127.0.0.1` as different `azp` values. The
 *  desktop shell historically loaded `127.0.0.1` while releases bundled only
 *  `localhost` in CLERK_AUTHORIZED_PARTIES — mirror loopback aliases. */
export function expandAuthorizedPartyOrigins(origins: string[]): string[] {
  const out = new Set(origins);
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (url.hostname === 'localhost') {
        url.hostname = '127.0.0.1';
        out.add(url.origin);
      } else if (url.hostname === '127.0.0.1') {
        url.hostname = 'localhost';
        out.add(url.origin);
      }
    } catch {
      // ignore malformed entries
    }
  }
  return [...out];
}

/** Origins Clerk should accept as `azp` claim values. In dev the web app
 *  runs on :5173 (Vite) and may also be reached on :3000 via the proxy,
 *  so we allow both. Production sets `CLERK_AUTHORIZED_PARTIES` explicitly. */
function authorizedPartiesFor(envValue: string): string[] {
  const base =
    envValue.trim().length > 0
      ? envValue.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
      : ['http://localhost:5173', 'http://localhost:3000'];
  return expandAuthorizedPartyOrigins(base);
}

/** Result categories:
 *   - 'verified' — JWT was valid and carries an active org claim.
 *   - 'no-org'   — JWT was valid but user hasn't selected an organization.
 *                  Web app should prompt them via <OrganizationSwitcher />.
 *   - 'invalid'  — token missing, expired, or signature failed.
 *   - 'dev-fallback' — Clerk isn't configured; caller should pin to pilot tenant.
 */
export type AuthOutcome =
  | { kind: 'verified'; auth: VerifiedAuth }
  | { kind: 'no-org' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'dev-fallback' };

export async function verifyBearerToken(
  request: FastifyRequest,
  secretKey: string,
  publishableKey?: string,
  authorizedPartiesEnv = '',
): Promise<AuthOutcome> {
  if (!secretKey) return { kind: 'dev-fallback' };

  // Build a WHATWG Request the Clerk SDK can authenticate against. The SDK
  // reads the Authorization header itself; we just have to give it the URL
  // and headers from the incoming Fastify request.
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }

  // The WHATWG Request constructor needs a valid URL string but Clerk's
  // authenticateRequest only inspects headers (Authorization, Cookie) — the
  // URL host/port has no effect on token verification. Derive it from the
  // inbound Host header so the URL reflects whatever LAN address the client
  // actually hit. Falls back to a stable placeholder when Host is missing
  // (Clerk-rejected requests in tests, etc).
  const hostHeader = typeof request.headers.host === 'string' ? request.headers.host : '127.0.0.1';
  const fakeUrl = `http://${hostHeader}${request.url}`;
  const req = new Request(fakeUrl, { headers });
  const authorizedParties = authorizedPartiesFor(authorizedPartiesEnv);

  try {
    const result = await getClerkClient(secretKey, publishableKey).authenticateRequest(
      req,
      { authorizedParties },
    );
    // @clerk/backend v1.x: RequestState has `status: 'signed-in' | 'signed-out'
    // | 'handshake'`. Only 'signed-in' carries claims via toAuth().
    if (result.status !== 'signed-in') {
      const reason = (result as { reason?: string }).reason ?? `status=${result.status}`;
      // Log loudly the first few times — token-verification rejections are
      // a frequent silent failure during initial Clerk setup.
      request.log.warn({ reason, status: result.status }, 'clerk: verifyBearerToken rejected');
      return { kind: 'invalid', reason };
    }
    const claims = result.toAuth();
    if (!claims) {
      return { kind: 'invalid', reason: 'toAuth() returned null on signed-in state' };
    }
    const clerkUserId = claims.userId;
    // Clerk's typed claims expose `orgId` when the active session has an
    // organization selected. Token format v2 puts it under `o.id` instead
    // of the top-level `orgId` claim — handle both.
    const c = claims as { orgId?: string; o?: { id?: string } };
    const orgId = c.orgId ?? c.o?.id;
    if (!clerkUserId) {
      return { kind: 'invalid', reason: 'no user id in claims' };
    }
    if (!orgId) {
      return { kind: 'no-org' };
    }
    return { kind: 'verified', auth: { clerkUserId, orgId } };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'verification threw';
    request.log.warn({ reason }, 'clerk: verifyBearerToken threw');
    return { kind: 'invalid', reason };
  }
}
