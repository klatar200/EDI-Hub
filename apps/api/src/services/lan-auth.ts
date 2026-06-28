/**
 * SEC-C1 — LAN API token for desktop hub production without Clerk.
 *
 * When `EDI_HUB_LAN_API_TOKEN` is set (≥32 chars) and the hub runs in desktop
 * mode, requests may authenticate with `Authorization: Bearer <token>` instead
 * of a Clerk JWT. This closes the open-admin LAN exposure from dev-fallback.
 */
import { timingSafeEqual, createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export const LAN_TOKEN_USER_ID = '00000000-0000-0000-0000-000000000099';
export const LAN_TOKEN_MIN_LENGTH = 32;

export function lanTokenConfigured(token: string | undefined): boolean {
  return typeof token === 'string' && token.trim().length >= LAN_TOKEN_MIN_LENGTH;
}

export function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/** Constant-time compare to avoid leaking token length via timing. */
export function verifyLanApiToken(provided: string, expected: string): boolean {
  if (!lanTokenConfigured(expected) || provided.length === 0) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
