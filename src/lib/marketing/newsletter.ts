import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import { queueEmail } from '@/lib/email/outbox';
import { scoreSpam } from '@/lib/services/enquiries';

/**
 * Newsletter subscription (roadmap §18.2).
 *
 * Small surface, three decisions worth stating:
 *
 *   1. **A duplicate is a SUCCESS.** Telling someone "you already subscribed"
 *      is noise to them and a disclosure to everyone else — it confirms which
 *      addresses are on the list to anyone willing to type one in. The caller
 *      cannot tell the two apart either; only the row count changes.
 *
 *   2. **The unsubscribe token is minted at subscribe time**, so the very
 *      first email can carry a working link. Generating it at send time means
 *      the first send is the one that cannot be unsubscribed from.
 *
 *   3. **Spam scoring is reused, not reinvented.** The honeypot and timing
 *      checks that protect the enquiry form protect this too.
 */

export const SUBSCRIBE_PER_HOUR = 3;

export interface SubscribeInput {
  email: string;
  source?: string;
  /** Honeypot — must be empty. */
  website?: string;
  /** Milliseconds the form was on screen. */
  elapsedMs?: number;
  clientHash: string;
}

export interface SubscribeResult {
  ok: boolean;
  error?: string;
  /** True when the address was already on the list. Never shown to the sender. */
  duplicate?: boolean;
  /** True when filed as spam. Also never shown to the sender. */
  filtered?: boolean;
}

/**
 * Loose on purpose.
 *
 * A strict RFC 5322 pattern rejects valid addresses, and the only real test of
 * an address is sending to it. This catches typing, not exotica.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function subscribe(
  input: SubscribeInput,
  db: Database = getDb(),
): SubscribeResult {
  const email = input.email.trim().slice(0, 200);
  const lower = email.toLowerCase();

  if (!EMAIL.test(email)) {
    return { ok: false, error: 'Check that email address' };
  }

  const recent = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM newsletter_subscribers
          WHERE client_hash = ? AND created_at >= datetime('now', '-1 hour')`,
      )
      .get(input.clientHash) as { n: number }
  ).n;

  if (recent >= SUBSCRIBE_PER_HOUR) {
    return { ok: false, error: 'That is enough for now. Try again later.' };
  }

  /**
   * Reuses the enquiry spam scorer. `message` is the address, because that is
   * the only free text here — the honeypot and the timing check do the work.
   */
  const verdict = scoreSpam({
    serviceSlug: 'newsletter',
    name: email,
    email,
    message: email,
    ...(input.website !== undefined ? { website: input.website } : {}),
    ...(input.elapsedMs !== undefined ? { elapsedMs: input.elapsedMs } : {}),
  });

  // Filed silently: the sender gets the same answer either way, so a bot
  // learns nothing about which signal caught it.
  if (verdict.spam) return { ok: true, filtered: true };

  const unsubToken = randomBytes(24).toString('base64url');

  /**
   * INSERT ... ON CONFLICT DO NOTHING, not SELECT-then-INSERT.
   *
   * Two requests with the same address can both pass a prior SELECT; only one
   * can win the unique index. `changes` tells us which happened without a
   * second query and without a race.
   */
  const result = db
    .prepare(
      `INSERT INTO newsletter_subscribers
         (id, email, email_lower, source, client_hash, unsub_token)
       VALUES (@id, @email, @lower, @source, @client, @unsub)
       ON CONFLICT(email_lower) DO NOTHING`,
    )
    .run({
      id: `sub_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      email,
      lower,
      source: (input.source ?? 'landing').slice(0, 40),
      client: input.clientHash,
      unsub: unsubToken,
    });

  if (result.changes === 0) {
    // Already subscribed. Success, and no second welcome email.
    return { ok: true, duplicate: true };
  }

  queueEmail(
    email,
    "You're on the list — Creative Design Networks",
    [
      'Thanks for signing up.',
      '',
      'We will email you when there is genuinely something to see. No newsletter,',
      'no sequence — one message when the platform is ready to look at.',
      '',
      `Unsubscribe: /unsubscribe?token=${unsubToken}`,
    ].join('\n'),
    db,
  );

  return { ok: true };
}

export function unsubscribe(token: string, db: Database = getDb()): boolean {
  const result = db
    .prepare(
      `UPDATE newsletter_subscribers SET unsubscribed_at = datetime('now')
        WHERE unsub_token = ? AND unsubscribed_at IS NULL`,
    )
    .run(token);
  return result.changes > 0;
}

export function subscriberCount(db: Database = getDb()): number {
  return (
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE unsubscribed_at IS NULL',
      )
      .get() as { n: number }
  ).n;
}
