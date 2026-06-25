/**
 * D8 Sprint 1 — Ed25519 public key for offline license verification.
 *
 * Embed only the **public** half of your production keypair here.
 * Never commit the private key — use `scripts/issue-license-key.mjs` with
 * a local PEM file to sign customer license keys.
 */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA8f18yc0pdAbsXuR+Iha9drwNes3HY7id0fDLhpZu5WE=
-----END PUBLIC KEY-----
`;
