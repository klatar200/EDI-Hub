/**
 * D8 Sprint 1 — offline license validation and trial gating.
 *
 * Pure logic (no Electron imports) so unit tests can exercise every branch
 * without launching a BrowserWindow.
 */
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

export const TRIAL_DAYS = 14;
export const RENEWAL_WARN_DAYS = 30;
export const RENEWAL_GRACE_DAYS = 7;

export interface LicensePayload {
  customerId: string;
  /** ISO-8601 annual renewal date. */
  renewsAt: string;
  tier: string;
}

export interface LicenseDocument {
  payload: LicensePayload;
  /** base64url-encoded Ed25519 signature bytes. */
  signature: string;
}

export interface LicenseFile {
  firstLaunchAt: string;
  licenseKey?: string;
}

export type LicenseBlockReason = 'trial_expired' | 'license_expired';

export type LicenseEvaluation =
  | { kind: 'allowed'; renewalWarning?: { renewsAt: string; daysRemaining: number } }
  | { kind: 'blocked'; reason: LicenseBlockReason }
  | { kind: 'licensed' };

function canonicalPayloadJson(payload: LicensePayload): string {
  return JSON.stringify({
    customerId: payload.customerId,
    renewsAt: payload.renewsAt,
    tier: payload.tier,
  });
}

export function encodeLicenseKey(
  payload: LicensePayload,
  privateKeyPem: string,
): string {
  const message = Buffer.from(canonicalPayloadJson(payload), 'utf8');
  const privateKey = createPrivateKey(privateKeyPem);
  const signature = sign(null, message, privateKey);
  const doc: LicenseDocument = {
    payload,
    signature: signature.toString('base64url'),
  };
  return Buffer.from(JSON.stringify(doc), 'utf8').toString('base64url');
}

export function decodeLicenseKey(key: string): LicenseDocument {
  let raw: string;
  try {
    raw = Buffer.from(key.trim(), 'base64url').toString('utf8');
  } catch {
    throw new Error('License key is not valid base64url.');
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('License key payload is not valid JSON.');
  }
  if (!doc || typeof doc !== 'object') {
    throw new Error('License key is missing a document body.');
  }
  const { payload, signature } = doc as Partial<LicenseDocument>;
  if (!payload || typeof payload !== 'object') {
    throw new Error('License key is missing payload.');
  }
  if (typeof signature !== 'string' || signature.length === 0) {
    throw new Error('License key is missing signature.');
  }
  const p = payload as Partial<LicensePayload>;
  if (typeof p.customerId !== 'string' || p.customerId.length === 0) {
    throw new Error('License payload is missing customerId.');
  }
  if (typeof p.renewsAt !== 'string' || Number.isNaN(Date.parse(p.renewsAt))) {
    throw new Error('License payload has an invalid renewsAt date.');
  }
  if (typeof p.tier !== 'string' || p.tier.length === 0) {
    throw new Error('License payload is missing tier.');
  }
  return { payload: p as LicensePayload, signature };
}

export function verifyLicenseDocument(
  doc: LicenseDocument,
  publicKeyPem: string,
): boolean {
  const message = Buffer.from(canonicalPayloadJson(doc.payload), 'utf8');
  const sig = Buffer.from(doc.signature, 'base64url');
  const publicKey = createPublicKey(publicKeyPem);
  return verify(null, message, publicKey, sig);
}

export function validateLicenseKey(
  key: string,
  publicKeyPem: string,
): { ok: true; payload: LicensePayload } | { ok: false; error: string } {
  try {
    const doc = decodeLicenseKey(key);
    if (!verifyLicenseDocument(doc, publicKeyPem)) {
      return { ok: false, error: 'License signature is invalid.' };
    }
    return { ok: true, payload: doc.payload };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return ms / (24 * 60 * 60 * 1000);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Evaluate whether the app may run given persisted license state.
 * Callers pass `now` for testability.
 */
export function evaluateLicenseState(input: {
  now: Date;
  firstLaunchAt: string;
  licenseKey: string | null | undefined;
  publicKeyPem: string;
  trialDays?: number;
}): LicenseEvaluation {
  const trialDays = input.trialDays ?? TRIAL_DAYS;
  const firstLaunch = new Date(input.firstLaunchAt);
  if (Number.isNaN(firstLaunch.getTime())) {
    throw new Error('firstLaunchAt is not a valid ISO date.');
  }

  if (input.licenseKey) {
    const validated = validateLicenseKey(input.licenseKey, input.publicKeyPem);
    if (!validated.ok) {
      // Invalid stored key — fall through to trial logic rather than
      // hard-blocking on a corrupt file (fail-open is handled by caller).
      return evaluateTrialOnly(input.now, firstLaunch, trialDays);
    }
    const renewsAt = new Date(validated.payload.renewsAt);
    const daysUntilRenewal = daysBetween(startOfUtcDay(input.now), startOfUtcDay(renewsAt));
    if (daysUntilRenewal < -RENEWAL_GRACE_DAYS) {
      return { kind: 'blocked', reason: 'license_expired' };
    }
    if (daysUntilRenewal <= RENEWAL_WARN_DAYS && daysUntilRenewal >= -RENEWAL_GRACE_DAYS) {
      return {
        kind: 'allowed',
        renewalWarning: {
          renewsAt: validated.payload.renewsAt,
          daysRemaining: Math.ceil(daysUntilRenewal),
        },
      };
    }
    return { kind: 'licensed' };
  }

  return evaluateTrialOnly(input.now, firstLaunch, trialDays);
}

function evaluateTrialOnly(
  now: Date,
  firstLaunch: Date,
  trialDays: number,
): LicenseEvaluation {
  const elapsedDays = daysBetween(startOfUtcDay(firstLaunch), startOfUtcDay(now));
  if (elapsedDays > trialDays) {
    return { kind: 'blocked', reason: 'trial_expired' };
  }
  return { kind: 'allowed' };
}

export function readLicenseFileFromJson(raw: string | null): LicenseFile | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LicenseFile>;
    if (typeof parsed.firstLaunchAt !== 'string') return null;
    const out: LicenseFile = { firstLaunchAt: parsed.firstLaunchAt };
    if (typeof parsed.licenseKey === 'string' && parsed.licenseKey.length > 0) {
      out.licenseKey = parsed.licenseKey;
    }
    return out;
  } catch {
    return null;
  }
}

export function serializeLicenseFile(file: LicenseFile): string {
  return JSON.stringify(file, null, 2);
}
