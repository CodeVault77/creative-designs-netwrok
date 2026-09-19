import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createUser } from '@/lib/db/repo';
import { open, seal, TamperedSecret } from './secrets';
import {
  codeFor,
  decodeBase32,
  encodeBase32,
  generateSecret,
  provisioningUri,
  stepFor,
  STEP_SECONDS,
  verify,
  WINDOW_STEPS,
} from './totp';
import {
  beginEnrolment,
  challenge,
  confirmEnrolment,
  disable,
  isEnforced,
  regenerateRecoveryCodes,
  statusFor,
  RECOVERY_CODE_COUNT,
} from './mfa';

/**
 * Second-factor tests.
 *
 * ── What is actually being defended ─────────────────────────────────────────
 *
 * MFA exists for one scenario: the attacker has the password. Every test below
 * assumes that and asks whether they get in anyway. The four ways they could:
 *
 *   replay        reusing a code they observed, inside its own window;
 *   brute force   a six-digit code is a million guesses;
 *   removal       stripping MFA with the stolen session instead of defeating it;
 *   the database  reading the secret out of a dump and generating codes.
 *
 * Each has a block.
 */

let db: Database;

beforeEach(() => {
  db = createTestDb();

  createUser(
    {
      id: 'u_person',
      email: 'person@example.com',
      passwordHash: 'x',
      handle: 'person',
      displayName: 'Person',
    },
    db,
  );
});

/** Enrol and confirm, returning the secret and the recovery codes. */
function enrolled(): { secret: string; codes: string[] } {
  const begun = beginEnrolment('u_person', 'person@example.com', db);
  const secret = begun.enrolment!.secret;

  const confirmed = confirmEnrolment('u_person', codeFor(secret, stepFor()), db);

  return { secret, codes: confirmed.recoveryCodes! };
}

// ---------------------------------------------------------------- base32

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (let length = 1; length <= 32; length += 1) {
      const bytes = randomBytes(length);
      expect(decodeBase32(encodeBase32(bytes))).toEqual(bytes);
    }
  });

  it('matches the RFC 4648 test vectors', () => {
    // Unpadded, which is what the otpauth URI scheme uses.
    expect(encodeBase32(Buffer.from('f'))).toBe('MY');
    expect(encodeBase32(Buffer.from('fo'))).toBe('MZXQ');
    expect(encodeBase32(Buffer.from('foo'))).toBe('MZXW6');
    expect(encodeBase32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('tolerates the spaces and lower case people type', () => {
    // These get retyped by hand from a screen. Rejecting a stray space helps
    // nobody and produces a support ticket.
    expect(decodeBase32('mzxw 6ytb oi')).toEqual(Buffer.from('foobar'));
  });
});

// ------------------------------------------------------------------ TOTP

describe('TOTP', () => {
  it('matches the RFC 6238 test vector', () => {
    /*
     * The published vector for the SHA-1 secret "12345678901234567890" at
     * T=59, which is step 1. If this fails, every authenticator app in the
     * world disagrees with us — so it is the single most valuable assertion
     * in this file.
     */
    const secret = encodeBase32(Buffer.from('12345678901234567890'));

    expect(codeFor(secret, 1)).toBe('287082');
    expect(codeFor(secret, 37037036)).toBe('081804');
  });

  it('produces six digits, zero-padded', () => {
    const secret = generateSecret();

    for (let step = 0; step < 200; step += 1) {
      expect(codeFor(secret, step)).toMatch(/^\d{6}$/);
    }
  });

  it('accepts the current code', () => {
    const secret = generateSecret();
    const now = Date.now();

    expect(
      verify(secret, codeFor(secret, stepFor(now)), { atMillis: now }).ok,
    ).toBe(true);
  });

  it('accepts one step of drift either way', () => {
    // A phone's clock drifts and typing six digits takes time. Zero tolerance
    // is correct in theory and gets MFA switched off in practice.
    const secret = generateSecret();
    const now = Date.now();
    const step = stepFor(now);

    expect(
      verify(secret, codeFor(secret, step - WINDOW_STEPS), { atMillis: now }).ok,
    ).toBe(true);
    expect(
      verify(secret, codeFor(secret, step + WINDOW_STEPS), { atMillis: now }).ok,
    ).toBe(true);
  });

  it('refuses a code from outside the window', () => {
    const secret = generateSecret();
    const now = Date.now();
    const step = stepFor(now);

    expect(verify(secret, codeFor(secret, step - 5), { atMillis: now }).ok).toBe(
      false,
    );
    expect(verify(secret, codeFor(secret, step + 5), { atMillis: now }).ok).toBe(
      false,
    );
  });

  it('refuses a code from a different secret', () => {
    const now = Date.now();
    const mine = generateSecret();
    const theirs = generateSecret();

    expect(verify(mine, codeFor(theirs, stepFor(now)), { atMillis: now }).ok).toBe(
      false,
    );
  });

  it('refuses anything that is not six digits', () => {
    const secret = generateSecret();

    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56 78']) {
      expect(verify(secret, bad).ok).toBe(false);
    }
  });

  it('reports the step it accepted, so replay can be closed', () => {
    const secret = generateSecret();
    const now = Date.now();
    const step = stepFor(now);

    expect(verify(secret, codeFor(secret, step), { atMillis: now }).step).toBe(
      step,
    );
  });

  it('refuses a code at or below the last accepted step', () => {
    /*
     * The replay defence. Without it a code stays valid for the rest of its
     * ninety-second window, which is ample for a phishing proxy to relay one
     * it just captured.
     */
    const secret = generateSecret();
    const now = Date.now();
    const step = stepFor(now);

    expect(
      verify(secret, codeFor(secret, step), { atMillis: now, lastStep: step }).ok,
    ).toBe(false);

    expect(
      verify(secret, codeFor(secret, step - 1), { atMillis: now, lastStep: step })
        .ok,
    ).toBe(false);
  });

  it('builds a provisioning URI an authenticator can read', () => {
    const uri = provisioningUri({
      secret: 'ABCDEFGH',
      account: 'person@example.com',
      issuer: 'Creative Design Networks',
    });

    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('secret=ABCDEFGH');
    // The issuer appears twice — in the label and as a parameter — because
    // apps disagree about which one they read.
    expect(uri).toContain('issuer=Creative+Design+Networks');
    expect(uri).toContain(`period=${STEP_SECONDS}`);
  });
});

// --------------------------------------------------------------- at rest

describe('secrets at rest', () => {
  it('round-trips', () => {
    const secret = generateSecret();
    expect(open(seal(secret))).toBe(secret);
  });

  it('produces different ciphertext for the same value', () => {
    // A fresh IV each time. Identical ciphertext would tell an attacker with
    // read access which users share a secret — and that two enrolments were
    // the same one repeated.
    const secret = generateSecret();
    expect(seal(secret)).not.toBe(seal(secret));
  });

  it('refuses a ciphertext that has been altered', () => {
    /*
     * GCM's authentication tag. Without it, somebody with write access to the
     * database could flip bits and silently change which codes are accepted —
     * and decryption would succeed, returning garbage nobody noticed.
     */
    const sealed = seal(generateSecret());
    const [iv, tag, data] = sealed.split('.') as [string, string, string];

    const flipped = Buffer.from(data, 'base64url');
    flipped[0] = flipped[0]! ^ 0xff;

    expect(() => open([iv, tag, flipped.toString('base64url')].join('.'))).toThrow(
      TamperedSecret,
    );
  });

  it('refuses a ciphertext encrypted with a different key', () => {
    const other = randomBytes(32);
    expect(() => open(seal(generateSecret()), other)).toThrow(TamperedSecret);
  });

  it('refuses a malformed blob rather than returning null', () => {
    // There is no return value that would let a caller carry on safely, so
    // there is no return value at all.
    for (const bad of ['', 'nonsense', 'a.b', 'a.b.c.d']) {
      expect(() => open(bad)).toThrow(TamperedSecret);
    }
  });
});

// -------------------------------------------------------------- enrolment

describe('enrolment', () => {
  it('does not gate sign-in until a code is proved', () => {
    /*
     * The single most important behaviour here. A one-step enrolment locks
     * people out permanently when their authenticator silently fails to save
     * the secret — and the failure is unrecoverable.
     */
    beginEnrolment('u_person', 'person@example.com', db);

    expect(isEnforced('u_person', db)).toBe(false);
    expect(statusFor('u_person', db)).toMatchObject({
      enrolled: true,
      confirmed: false,
    });
  });

  it('turns on once a real code is entered', () => {
    const { secret } = enrolled();

    expect(isEnforced('u_person', db)).toBe(true);
    expect(secret.length).toBeGreaterThan(10);
  });

  it('refuses a wrong code and stays off', () => {
    beginEnrolment('u_person', 'person@example.com', db);

    expect(confirmEnrolment('u_person', '000000', db).ok).toBe(false);
    expect(isEnforced('u_person', db)).toBe(false);
  });

  it('issues recovery codes exactly once', () => {
    const { codes } = enrolled();

    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);

    // Never readable again. Only the hashes are stored.
    const stored = db
      .prepare('SELECT code_hash FROM mfa_recovery_codes WHERE user_id = ?')
      .all('u_person') as { code_hash: string }[];

    for (const code of codes) {
      expect(stored.some((row) => row.code_hash === code)).toBe(false);
    }
  });

  it('will not silently replace a confirmed enrolment', () => {
    /*
     * Otherwise anyone holding a live session could swap the second factor for
     * one they control — which is precisely the escalation MFA exists to stop.
     */
    enrolled();

    expect(beginEnrolment('u_person', 'person@example.com', db).ok).toBe(false);
    expect(isEnforced('u_person', db)).toBe(true);
  });

  it('stores the secret encrypted, not in clear', () => {
    const { secret } = enrolled();

    const row = db
      .prepare('SELECT secret_cipher FROM user_mfa WHERE user_id = ?')
      .get('u_person') as { secret_cipher: string };

    expect(row.secret_cipher).not.toContain(secret);
    expect(open(row.secret_cipher)).toBe(secret);
  });
});

// -------------------------------------------------------------- challenge

describe('the challenge', () => {
  it('accepts a current code', () => {
    const { secret } = enrolled();

    // A later step than the one confirmation consumed: the same code twice is
    // a replay, which the next test covers.
    const code = codeFor(secret, stepFor() + 1);
    expect(challenge('u_person', code, db).ok).toBe(true);
  });

  it('refuses the same code twice', () => {
    const { secret } = enrolled();
    const code = codeFor(secret, stepFor() + 1);

    expect(challenge('u_person', code, db).ok).toBe(true);
    // The replay. A ninety-second window is long enough to relay a captured
    // code, so accepting one twice would make the window the vulnerability.
    expect(challenge('u_person', code, db).ok).toBe(false);
  });

  it('refuses a wrong code', () => {
    enrolled();
    expect(challenge('u_person', '000000', db).ok).toBe(false);
  });

  it('refuses everything when nobody is enrolled', () => {
    expect(challenge('u_person', '123456', db).failure).toBe('not_enrolled');
  });

  it('accepts a recovery code', () => {
    const { codes } = enrolled();

    const result = challenge('u_person', codes[0]!, db);

    expect(result.ok).toBe(true);
    expect(result.usedRecovery).toBe(true);
  });

  it('spends a recovery code exactly once', () => {
    const { codes } = enrolled();

    expect(challenge('u_person', codes[0]!, db).ok).toBe(true);
    expect(challenge('u_person', codes[0]!, db).ok).toBe(false);

    expect(statusFor('u_person', db).recoveryRemaining).toBe(
      RECOVERY_CODE_COUNT - 1,
    );
  });

  it('leaves the other recovery codes usable', () => {
    const { codes } = enrolled();

    challenge('u_person', codes[0]!, db);

    expect(challenge('u_person', codes[1]!, db).ok).toBe(true);
  });

  it('accepts a recovery code in either case', () => {
    // These are read off paper. Case is not a security boundary.
    const { codes } = enrolled();

    expect(challenge('u_person', codes[0]!.toLowerCase(), db).ok).toBe(true);
  });

  it('refuses another person’s recovery code', () => {
    createUser(
      {
        id: 'u_other',
        email: 'other@example.com',
        passwordHash: 'x',
        handle: 'other',
        displayName: 'Other',
      },
      db,
    );

    const { codes } = enrolled();

    // u_other is not enrolled, so this is refused on that ground — but the
    // code must not work for them even so.
    expect(challenge('u_other', codes[0]!, db).ok).toBe(false);
    expect(statusFor('u_person', db).recoveryRemaining).toBe(RECOVERY_CODE_COUNT);
  });
});

// ----------------------------------------------------------------- removal

describe('turning it off', () => {
  it('requires a current code', () => {
    /*
     * The attack this closes: a stolen SESSION is exactly what MFA is meant to
     * survive. If a live session could strip the second factor, MFA would
     * protect only the sign-in form and nothing after it.
     */
    enrolled();

    expect(disable('u_person', '000000', db).ok).toBe(false);
    expect(isEnforced('u_person', db)).toBe(true);
  });

  it('removes the secret and the recovery codes together', () => {
    const { secret } = enrolled();

    expect(disable('u_person', codeFor(secret, stepFor() + 1), db).ok).toBe(true);

    expect(isEnforced('u_person', db)).toBe(false);
    expect(statusFor('u_person', db).recoveryRemaining).toBe(0);
  });

  it('can be turned off with a recovery code', () => {
    // The phone-in-the-river case: somebody who cannot produce a TOTP code
    // still has to be able to get their account back.
    const { codes } = enrolled();

    expect(disable('u_person', codes[0]!, db).ok).toBe(true);
    expect(isEnforced('u_person', db)).toBe(false);
  });
});

describe('regenerating recovery codes', () => {
  it('requires a current code', () => {
    enrolled();
    expect(regenerateRecoveryCodes('u_person', '000000', db).ok).toBe(false);
  });

  it('invalidates the old set', () => {
    const { secret, codes } = enrolled();

    const fresh = regenerateRecoveryCodes(
      'u_person',
      codeFor(secret, stepFor() + 1),
      db,
    );

    expect(fresh.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    // The old ones are gone. Regenerating exists because the old set may have
    // been seen by somebody.
    expect(challenge('u_person', codes[0]!, db).ok).toBe(false);
    expect(challenge('u_person', fresh.recoveryCodes![0]!, db).ok).toBe(true);
  });
});
