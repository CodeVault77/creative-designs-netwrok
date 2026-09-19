import 'server-only';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';

import { open, seal } from './secrets';
import { generateSecret, provisioningUri, verify } from './totp';

/**
 * Two-factor authentication.
 *
 * ── Enrolment is two steps, and that is the important part ──────────────────
 *
 * `beginEnrolment` writes an UNCONFIRMED row and hands back a secret. Nothing
 * changes about signing in until `confirmEnrolment` succeeds with a real code
 * from the person's own authenticator.
 *
 * One step would be simpler and would lock people out. Somebody scans a QR
 * code, the app silently fails to save it, they close the page — and the next
 * sign-in demands a code that no device on earth can produce. Requiring proof
 * before switching it on means the failure mode is "MFA did not get enabled",
 * which is recoverable by trying again.
 *
 * ── Recovery codes are the other half of not being locked out ───────────────
 *
 * Phones are lost, stolen, and dropped in rivers. Ten single-use codes, shown
 * once at enrolment and stored hashed, are what stands between that and an
 * account nobody can reach. They are hashed rather than encrypted because
 * unlike the TOTP secret they are only ever COMPARED — see `secrets.ts` for
 * why that distinction decides the storage.
 */

export const RECOVERY_CODE_COUNT = 10;

/**
 * What the authenticator app lists this account under.
 *
 * A product name rather than a hostname, because that is what a person
 * recognises in a list of twenty entries eighteen months later — and because
 * it must not change when the deployment moves. An issuer that changed would
 * leave every existing entry looking like it belonged to something else.
 */
const ISSUER = 'Creative Design Networks';

export interface MfaStatus {
  enrolled: boolean;
  /** True only once a code has been proved. Sign-in gates on this. */
  confirmed: boolean;
  recoveryRemaining: number;
}

interface MfaRow {
  user_id: string;
  secret_cipher: string;
  confirmed_at: string | null;
  last_step: number | null;
}

export function statusFor(userId: string, db: Database = getDb()): MfaStatus {
  const row = db.prepare('SELECT * FROM user_mfa WHERE user_id = ?').get(userId) as
    MfaRow | undefined;

  const remaining = (
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL',
      )
      .get(userId) as { n: number }
  ).n;

  return {
    enrolled: Boolean(row),
    confirmed: Boolean(row?.confirmed_at),
    recoveryRemaining: remaining,
  };
}

/** The only question sign-in needs to ask. */
export function isEnforced(userId: string, db: Database = getDb()): boolean {
  const row = db
    .prepare('SELECT confirmed_at FROM user_mfa WHERE user_id = ?')
    .get(userId) as { confirmed_at: string | null } | undefined;

  return Boolean(row?.confirmed_at);
}

export interface Enrolment {
  secret: string;
  /** For the QR code. The app reads this. */
  uri: string;
}

/**
 * Start enrolling. Replaces any unconfirmed attempt.
 *
 * A CONFIRMED enrolment is not replaced — that would let anyone with a live
 * session silently swap the second factor for one they control, which is
 * exactly the escalation MFA exists to stop. Changing a confirmed factor goes
 * through `disable`, which demands proof first.
 */
export function beginEnrolment(
  userId: string,
  accountLabel: string,
  db: Database = getDb(),
): { ok: boolean; enrolment?: Enrolment; error?: string } {
  if (isEnforced(userId, db)) {
    return { ok: false, error: 'Two-factor is already on for this account' };
  }

  const secret = generateSecret();

  db.prepare(
    `INSERT INTO user_mfa (user_id, secret_cipher, confirmed_at, last_step)
     VALUES (@userId, @cipher, NULL, NULL)
     ON CONFLICT(user_id) DO UPDATE SET
       secret_cipher = excluded.secret_cipher,
       confirmed_at = NULL,
       last_step = NULL`,
  ).run({ userId, cipher: seal(secret) });

  return {
    ok: true,
    enrolment: {
      secret,
      uri: provisioningUri({
        secret,
        account: accountLabel,
        // What the authenticator app lists it under. The site name rather
        // than a hostname, because that is what a person recognises in a list
        // of twenty entries eighteen months later.
        issuer: ISSUER,
      }),
    },
  };
}

export interface ConfirmResult {
  ok: boolean;
  /** Shown once, immediately, and never again. */
  recoveryCodes?: string[];
  error?: string;
}

function hashCode(code: string): string {
  return createHash('sha256').update(code.toUpperCase()).digest('hex');
}

/**
 * A recovery code.
 *
 * Grouped with a dash because these get written down and read back by a human
 * under stress. Base32's alphabet is used for the same reason: no 0/O and no
 * 1/I to mistype.
 */
function makeRecoveryCode(): string {
  const raw = randomBytes(10)
    .toString('base64')
    .replace(/[^A-Z2-7]/gi, '')
    .toUpperCase()
    .slice(0, 10)
    .padEnd(10, 'A');

  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** Prove a code and switch MFA on, returning the recovery codes. */
export function confirmEnrolment(
  userId: string,
  code: string,
  db: Database = getDb(),
): ConfirmResult {
  const row = db.prepare('SELECT * FROM user_mfa WHERE user_id = ?').get(userId) as
    MfaRow | undefined;

  if (!row) return { ok: false, error: 'Start again' };
  if (row.confirmed_at) return { ok: false, error: 'Already on' };

  const result = verify(open(row.secret_cipher), code, { lastStep: row.last_step });
  if (!result.ok) return { ok: false, error: 'That code is not right' };

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, makeRecoveryCode);

  db.transaction(() => {
    db.prepare(
      "UPDATE user_mfa SET confirmed_at = datetime('now'), last_step = ? WHERE user_id = ?",
    ).run(result.step ?? null, userId);

    // Any codes from a previous enrolment are gone: they belonged to a secret
    // that no longer opens anything.
    db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);

    for (const plain of codes) {
      db.prepare(
        'INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)',
      ).run(randomUUID(), userId, hashCode(plain));
    }
  })();

  return { ok: true, recoveryCodes: codes };
}

export type ChallengeFailure = 'not_enrolled' | 'wrong_code';

export interface ChallengeResult {
  ok: boolean;
  /** True when a recovery code was spent rather than a TOTP code entered. */
  usedRecovery?: boolean;
  failure?: ChallengeFailure;
}

/**
 * Check a code at sign-in. Accepts a TOTP code or a recovery code.
 *
 * ── Both paths, one entry point ─────────────────────────────────────────────
 *
 * Two endpoints would mean the client deciding which kind of code it was
 * looking at, and getting that wrong in front of someone already locked out.
 * The shapes are unambiguous — six digits or a dashed pair — so the server can
 * simply try both.
 */
export function challenge(
  userId: string,
  code: string,
  db: Database = getDb(),
): ChallengeResult {
  const row = db.prepare('SELECT * FROM user_mfa WHERE user_id = ?').get(userId) as
    MfaRow | undefined;

  if (!row?.confirmed_at) return { ok: false, failure: 'not_enrolled' };

  const totp = verify(open(row.secret_cipher), code, { lastStep: row.last_step });

  if (totp.ok) {
    /*
     * The accepted step is recorded, which is what closes replay. Without it a
     * code stays valid for the rest of its ninety-second window, and that is
     * long enough for a phishing proxy to relay one it just captured.
     */
    db.prepare('UPDATE user_mfa SET last_step = ? WHERE user_id = ?').run(
      totp.step ?? null,
      userId,
    );

    return { ok: true };
  }

  return spendRecoveryCode(userId, code, db);
}

/**
 * Spend a recovery code, if it matches an unused one.
 *
 * Compared in constant time against every unused row rather than looked up by
 * hash. A lookup would be faster and would leak: the timing difference between
 * "no such code" and "found but already used" tells an attacker which of their
 * guesses were real codes.
 */
function spendRecoveryCode(
  userId: string,
  code: string,
  db: Database,
): ChallengeResult {
  const candidate = Buffer.from(hashCode(code.trim()), 'hex');

  const rows = db
    .prepare(
      'SELECT id, code_hash FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL',
    )
    .all(userId) as { id: string; code_hash: string }[];

  let matched: string | null = null;

  for (const row of rows) {
    const stored = Buffer.from(row.code_hash, 'hex');

    if (
      stored.length === candidate.length &&
      timingSafeEqual(stored, candidate) &&
      matched === null
    ) {
      matched = row.id;
    }
  }

  if (!matched) return { ok: false, failure: 'wrong_code' };

  // Marked used in the WHERE clause as well as the SET, so two concurrent
  // attempts with the same code cannot both succeed.
  const spent = db
    .prepare(
      "UPDATE mfa_recovery_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL",
    )
    .run(matched).changes;

  return spent > 0
    ? { ok: true, usedRecovery: true }
    : { ok: false, failure: 'wrong_code' };
}

/**
 * Turn MFA off. Requires a current code.
 *
 * Demanding proof to REMOVE a factor is the point. Otherwise a stolen session
 * — which is precisely what MFA is meant to survive — is enough to strip the
 * protection and then do whatever it liked.
 */
export function disable(
  userId: string,
  code: string,
  db: Database = getDb(),
): { ok: boolean; error?: string } {
  const proof = challenge(userId, code, db);
  if (!proof.ok) return { ok: false, error: 'That code is not right' };

  db.transaction(() => {
    db.prepare('DELETE FROM user_mfa WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);
  })();

  return { ok: true };
}

/** Issue a fresh set, invalidating the old. Requires a current code. */
export function regenerateRecoveryCodes(
  userId: string,
  code: string,
  db: Database = getDb(),
): ConfirmResult {
  const proof = challenge(userId, code, db);
  if (!proof.ok) return { ok: false, error: 'That code is not right' };

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, makeRecoveryCode);

  db.transaction(() => {
    db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);

    for (const plain of codes) {
      db.prepare(
        'INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)',
      ).run(randomUUID(), userId, hashCode(plain));
    }
  })();

  return { ok: true, recoveryCodes: codes };
}
