import 'server-only';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import { emailProvider } from './provider';
import { markSent, pendingEmails } from './outbox';
import { registerHandler } from '@/lib/jobs/worker';
import { enqueue } from '@/lib/jobs/queue';

/**
 * The consumer the outbox never had.
 *
 * `queueEmail` has written rows since P7 and `pendingEmails`/`markSent` were
 * exported and never called by anything. This closes that loop: a job type that
 * takes what is pending, sends it, and marks it.
 */

export const DRAIN_OUTBOX_JOB = 'email.drain_outbox';

export interface DrainOutboxResult {
  attempted: number;
  sent: number;
  failed: number;
  /** Set when at least one failure looked transient — the job then retries. */
  retryable: boolean;
}

/**
 * Send everything pending, up to `limit`.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 *
 * The queue is at-least-once, so this can run twice on the same rows. Each
 * message is marked sent IMMEDIATELY after its own successful send, not in a
 * batch at the end — so a crash halfway through re-sends at most the message
 * that was in flight, rather than every message already delivered.
 *
 * ── Why one message at a time ───────────────────────────────────────────────
 *
 * A batch API would be faster and would make one failure ambiguous: with a
 * single rejected address in a batch of fifty you cannot tell which of the
 * other forty-nine went out. At this volume, clarity is worth more than
 * throughput.
 */
export async function drainOutbox(
  limit = 25,
  db: Database = getDb(),
): Promise<DrainOutboxResult> {
  const provider = emailProvider();
  const pending = pendingEmails(limit, db);

  const result: DrainOutboxResult = {
    attempted: pending.length,
    sent: 0,
    failed: 0,
    retryable: false,
  };

  for (const message of pending) {
    const outcome = await provider.send({
      to: message.to,
      subject: message.subject,
      body: message.body,
    });

    if (outcome.ok) {
      markSent(message.id, db);
      result.sent++;
      continue;
    }

    result.failed++;

    /*
     * A permanent rejection is left pending but NOT retried into oblivion —
     * the job below only re-runs while something transient failed. A bad
     * address stays visible in the outbox for a human to look at, which is
     * better than deleting the evidence that someone tried to contact them.
     */
    if (outcome.retryable !== false) result.retryable = true;

    console.error(
      `[email] send failed id=${message.id} retryable=${outcome.retryable} ${outcome.error ?? ''}`,
    );
  }

  return result;
}

/**
 * Registered at import time.
 *
 * Throwing is how the handler tells the queue to retry: `runJob` catches it and
 * `failJob` applies the backoff. Returning normally after a permanent failure
 * is deliberate — there is nothing to gain by retrying a malformed address.
 */
registerHandler(DRAIN_OUTBOX_JOB, async (_payload, db) => {
  const result = await drainOutbox(25, db);

  if (result.retryable && result.sent === 0 && result.attempted > 0) {
    throw new Error(
      `outbox drain: ${result.failed} of ${result.attempted} failed transiently`,
    );
  }
});

/**
 * Schedule a drain.
 *
 * Called after anything queues mail, so a message goes out on the next worker
 * pass rather than waiting for a scheduled sweep. The dedupe key collapses a
 * burst of sends into ONE pending drain — ten invitations in a minute should
 * not create ten jobs that each try to send the same queue.
 */
export function scheduleOutboxDrain(db: Database = getDb()): string {
  return enqueue(
    DRAIN_OUTBOX_JOB,
    {},
    { dedupeKey: 'outbox', delaySeconds: 5 },
    db,
  );
}
