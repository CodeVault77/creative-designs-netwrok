import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import { serverEnv } from '@/lib/env';

/**
 * Durable attempt limiting.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * Sign-in counted attempts in a per-process `Map`. Its own comment called it
 * "crude" and "not a substitute for the real one", which was honest, and it had
 * three faults worth naming because each defeats the purpose on its own:
 *
 *   - it reset on every deploy and every cold start, so waiting out a limit
 *     took as long as the next deployment;
 *   - it was per-instance, so running N instances multiplied the allowance
 *     by N without anyone deciding to;
 *   - it was never pruned, so every distinct email ever tried was retained
 *     for the life of the process — a memory leak an anonymous POST could
 *     drive.
 *
 * ── Two subjects, deliberately ──────────────────────────────────────────────
 *
 * Auth routes limit on the ACCOUNT and on the CLIENT, and both must pass.
 * Limiting only by account lets one attacker lock a victim out of their own
 * login by failing it repeatedly; limiting only by client lets a botnet spread
 * a credential-stuffing run thinly enough to never trip. Neither alone is
 * sufficient, which is why `check` is called twice rather than made cleverer.
 */

export interface Limit {
  /** Namespace, so sign-in attempts do not consume the reset allowance. */
  bucket: string;
  /** Attempts permitted inside the window. */
  max: number;
  windowSeconds: number;
}

export const LIMITS = {
  signIn: { bucket: 'sign_in', max: 10, windowSeconds: 300 },
  signUp: { bucket: 'sign_up', max: 5, windowSeconds: 3600 },
  passwordReset: { bucket: 'password_reset', max: 5, windowSeconds: 3600 },
} as const satisfies Record<string, Limit>;

/**
 * Identify a caller without storing what identifies them.
 *
 * Salted, so the table holds no reversible IP address — the same reasoning as
 * `lib/ingest/budget.ts`, and the reason `INGEST_HASH_SALT` must differ per
 * environment. Truncated because collisions between two attackers are
 * harmless and the full digest is 32 bytes per row for nothing.
 */
export function subjectFor(value: string): string {
  return createHash('sha256')
    .update(`${serverEnv.INGEST_HASH_SALT}:${value.toLowerCase().trim()}`)
    .digest('hex')
    .slice(0, 32);
}

export interface LimitResult {
  ok: boolean;
  /** Attempts left in the window, for a Retry-After style hint. */
  remaining: number;
}

/**
 * Record an attempt and report whether it is over the limit.
 *
 * Counts BEFORE inserting, so the nth attempt is allowed and the (n+1)th is
 * not. Recording first would make the limit off by one and, worse, would mean
 * a refused attempt still counted toward the next window.
 */
export function check(
  limit: Limit,
  subject: string,
  db: Database = getDb(),
): LimitResult {
  const window = `-${limit.windowSeconds} seconds`;

  const used = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM rate_limits
          WHERE bucket = @bucket AND subject = @subject
            AND attempted >= datetime('now', @window)`,
      )
      .get({ bucket: limit.bucket, subject, window }) as { n: number }
  ).n;

  if (used >= limit.max) return { ok: false, remaining: 0 };

  /*
   * One row per attempt, with its own id.
   *
   * An earlier version keyed the table on (bucket, subject, attempted) and used
   * INSERT OR IGNORE. Because datetime('now') resolves to whole seconds, every
   * attempt inside the same second collided and only the first counted — so an
   * attacker could make unlimited attempts simply by making them quickly. The
   * test caught it immediately, which is the argument for writing the negative
   * cases first.
   */
  db.prepare('INSERT INTO rate_limits (id, bucket, subject) VALUES (?, ?, ?)').run(
    randomUUID(),
    limit.bucket,
    subject,
  );

  return { ok: true, remaining: limit.max - used - 1 };
}

/**
 * Forget a subject's attempts.
 *
 * Called after a SUCCESSFUL sign-in, so someone who mistyped their password
 * four times and then got it right is not left one slip from being locked out
 * for five minutes.
 */
export function clear(limit: Limit, subject: string, db: Database = getDb()): void {
  db.prepare('DELETE FROM rate_limits WHERE bucket = ? AND subject = ?').run(
    limit.bucket,
    subject,
  );
}

/**
 * Drop rows outside every window.
 *
 * The table is append-only during an attack, so something has to remove the
 * rows or it grows without bound — the same fault as the Map this replaces,
 * just on disk instead of in memory. Called by the maintenance job rather than
 * on the request path, where it would make every sign-in pay for the cleanup.
 */
export function prune(olderThanSeconds = 86_400, db: Database = getDb()): number {
  return db
    .prepare(`DELETE FROM rate_limits WHERE attempted < datetime('now', ?)`)
    .run(`-${olderThanSeconds} seconds`).changes;
}
