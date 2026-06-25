/**
 * D8 Sprint 1 — license trial + Ed25519 key validation tests.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  TRIAL_DAYS,
  encodeLicenseKey,
  evaluateLicenseState,
  validateLicenseKey,
  type LicensePayload,
} from '../src/license.js';
import {
  ensureLicenseFile,
  loadLicenseFile,
  saveLicenseKey,
} from '../src/license-store.js';

function testKeypair(): { publicPem: string; privatePem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function futureIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function pastIso(days: number): string {
  return futureIso(-days);
}

function makeKey(privatePem: string, payload: LicensePayload): string {
  return encodeLicenseKey(payload, privatePem);
}

describe('evaluateLicenseState', () => {
  const { publicPem, privatePem } = testKeypair();
  const now = new Date('2026-06-25T12:00:00.000Z');

  it('allows trial within 14 days', () => {
    const firstLaunchAt = pastIso(13);
    const result = evaluateLicenseState({
      now,
      firstLaunchAt,
      licenseKey: null,
      publicKeyPem: publicPem,
    });
    assert.equal(result.kind, 'allowed');
  });

  it('blocks trial after 15 days', () => {
    const firstLaunchAt = pastIso(15);
    const result = evaluateLicenseState({
      now,
      firstLaunchAt,
      licenseKey: null,
      publicKeyPem: publicPem,
    });
    assert.deepEqual(result, { kind: 'blocked', reason: 'trial_expired' });
  });

  it('unlocks with a valid signed key', () => {
    const key = makeKey(privatePem, {
      customerId: 'cust-1',
      renewsAt: futureIso(200),
      tier: 'standard',
    });
    const result = evaluateLicenseState({
      now,
      firstLaunchAt: pastIso(30),
      licenseKey: key,
      publicKeyPem: publicPem,
    });
    assert.equal(result.kind, 'licensed');
  });

  it('rejects a tampered key', () => {
    const key = makeKey(privatePem, {
      customerId: 'cust-1',
      renewsAt: futureIso(200),
      tier: 'standard',
    });
    const tampered = `${key.slice(0, -4)}AAAA`;
    const validated = validateLicenseKey(tampered, publicPem);
    assert.equal(validated.ok, false);
  });

  it('warns within 30 days of renewal', () => {
    const key = makeKey(privatePem, {
      customerId: 'cust-1',
      renewsAt: futureIso(29),
      tier: 'standard',
    });
    const result = evaluateLicenseState({
      now,
      firstLaunchAt: pastIso(100),
      licenseKey: key,
      publicKeyPem: publicPem,
    });
    assert.equal(result.kind, 'allowed');
    if (result.kind === 'allowed') {
      assert.ok(result.renewalWarning);
      assert.equal(result.renewalWarning?.daysRemaining, 29);
    }
  });

  it('blocks 8 days past renewsAt', () => {
    const key = makeKey(privatePem, {
      customerId: 'cust-1',
      renewsAt: pastIso(8),
      tier: 'standard',
    });
    const result = evaluateLicenseState({
      now,
      firstLaunchAt: pastIso(400),
      licenseKey: key,
      publicKeyPem: publicPem,
    });
    assert.deepEqual(result, { kind: 'blocked', reason: 'license_expired' });
  });
});

describe('license-store', () => {
  it('records first launch once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edi-license-'));
    try {
      const now = new Date('2026-01-01T00:00:00.000Z');
      const a = ensureLicenseFile(dir, now);
      const b = ensureLicenseFile(dir, new Date('2026-06-01T00:00:00.000Z'));
      assert.equal(a.firstLaunchAt, b.firstLaunchAt);
      assert.equal(loadLicenseFile(dir)?.firstLaunchAt, a.firstLaunchAt);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists a license key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edi-license-'));
    const { publicPem, privatePem } = testKeypair();
    try {
      const key = makeKey(privatePem, {
        customerId: 'cust-2',
        renewsAt: futureIso(365),
        tier: 'standard',
      });
      saveLicenseKey(dir, key, new Date());
      const loaded = loadLicenseFile(dir);
      assert.equal(loaded?.licenseKey, key);
      const evalResult = evaluateLicenseState({
        now: new Date(),
        firstLaunchAt: loaded!.firstLaunchAt,
        licenseKey: loaded!.licenseKey,
        publicKeyPem: publicPem,
      });
      assert.notEqual(evalResult.kind, 'blocked');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('trial constant', () => {
  it('trial is 14 days per sprint plan', () => {
    assert.equal(TRIAL_DAYS, 14);
  });
});
