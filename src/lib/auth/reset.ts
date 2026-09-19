import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import { queueEmail } from '@/lib/email/outbox';
import { clientEnv } from '@/lib/env';
import { checkPassword, hashPassword } from './password';

/**
 * Password reset.
 *
 * §11 listed this as an open gap and gave the reason: it needs email delivery,
 * which did not exist until the outbox actually sent anything. It does now, so
 * this is the piece that was waiting on it.
 *
 * ── The token is stored hashed ──────────────────────────────────────────────
 *
 * `password_resets.token` holds a SHA-256 of the value in the email, never the
 * value itself. A reset token is a bearer credential — anyone holding one can
 * take the account — so a database leak must not hand over live tokens. The
 * same reasoning as storing password hashes, applied to the thing that can
 * bypass a password.
 *
 * ── Requesting a reset never says whether the account exists ────────────────
 *
 * `request()` returns the same result either way. A reset form that answers
 * "no such account" is an account enumeration oracle, and this codebase
 * consistently refuses to be one (404-never-403 elsewhere, the identical
 * message for a bad and an already-used invite code in `lib/launch/beta.ts`).
 */

const TTL_MINUTES = 60;

/** Long enough that guessing is hopeless; short enough to paste from an email. */
const TOKEN_BYTES = 32;

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface RequestResult {
  /**
   * Always true.
   *
   * Present so callers read as intention-revealing rather than ignoring a
   * return value — NOT so they can branch on it. Branching would reintroduce
   * exactly the oracle this avoids.
   */
  ok: true;
  /**
   * The raw token, for tests only.
   *
   * Never returned to a route: the token reaches the user through the email
   * and nowhere else. A route that echoed it would let anyone reset any
   * account by reading their own response body.
   */
  token?: string;
}

export function requestReset(email: string, db: Database = getDb()): RequestResult {
  const normalised = email.trim().toLowerCase();

  const user = db
    .prepare('SELECT id, display_name FROM users WHERE lower(email) = ?')
    .get(normalised) as { id: string; display_name: string } | undefined;

  // No account: stop here, and say nothing different.
  if (!user) return { ok: true };

  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  db.prepare(
    `INSERT INTO password_resets (token, user_id, expires_at)
     VALUES (?, ?, datetime('now', ?))`,
  ).run(digest(token), user.id, `+${TTL_MINUTES} minutes`);

  const url = `${clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')}/reset/${token}`;

  queueEmail(
    normalised,
    'Reset your password',
    [
      `Hello ${user.display_name},`,
      '',
      'Use this link to choose a new password:',
      url,
      '',
      `The link works once and expires in ${TTL_MINUTES} minutes.`,
      '',
      'If you did not ask for this, you can ignore it — nothing has changed.',
    ].join('\n'),
    db,
  );

  return { ok: true, token };
}

export interface ResetResult {
  ok: boolean;
  error?: string;
}

/**
 * Spend a token and set a new password.
 *
 * Single-use and atomic. The token is marked used in the SAME transaction as
 * the password change, so two requests racing the same token cannot both
 * succeed — the second finds `used_at` already set.
 */
export async function completeReset(
  token: string,
  newPassword: string,
  db: Database = getDb(),
): Promise<ResetResult> {
  const complaint = checkPassword(newPassword);
  if (complaint) return { ok: false, error: complaint.message };

  /*
   * Expiry is compared in SQL, never in JavaScript.
   *
   * SQLite writes datetimes as "YYYY-MM-DD HH:MM:SS" in UTC, with a space and
   * no zone marker. `new Date()` parses that spelling as LOCAL time, so on any
   * machine not running on UTC a token minted seconds ago read as already
   * expired — or, worse in the other direction, an expired one read as live.
   * Comparing inside the query keeps one clock and one timezone.
   */
  const row = db
    .prepare(
      `SELECT user_id, used_at,
              (expires_at > datetime('now')) AS live
         FROM password_resets WHERE token = ?`,
    )
    .get(digest(token)) as
    { user_id: string; used_at: string | null; live: number } | undefined;

  /*
   * One message for every failure: unknown, expired, or already spent.
   *
   * Distinguishing them tells whoever is holding a token which of those it is,
   * and none of that helps a legitimate user — who needs the same next step in
   * all three cases.
   */
  const invalid = { ok: false, error: 'That link is no longer valid' };
  if (!row || row.used_at || !row.live) return invalid;

  // Hashing is async and slow by design, so it happens BEFORE the transaction
  // — better-sqlite3 is synchronous and cannot await inside one.
  const hash = await hashPassword(newPassword);

  const changed = db.transaction(() => {
    const spent = db
      .prepare(
        `UPDATE password_resets SET used_at = datetime('now')
          WHERE token = ? AND used_at IS NULL`,
      )
      .run(digest(token));

    // Lost the race: another request spent this token first.
    if (spent.changes === 0) return false;

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      hash,
      row.user_id,
    );

    /*
     * Every session ends.
     *
     * Someone resetting a password may be doing it BECAUSE their account is
     * compromised. Leaving the attacker's session alive would make the reset
     * theatre — the whole point is to end access the old credential bought.
     */
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);

    return true;
  })();

  return changed ? { ok: true } : invalid;
}

/** Drop expired and spent tokens. Called by the maintenance job. */
export function pruneResets(db: Database = getDb()): number {
  return db
    .prepare(
      `DELETE FROM password_resets
        WHERE used_at IS NOT NULL OR expires_at < datetime('now')`,
    )
    .run().changes;
}
