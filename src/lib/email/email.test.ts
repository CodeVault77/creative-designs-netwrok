import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '@/lib/db/migrations';
import { queueEmail, pendingEmails } from './outbox';
import { MemoryEmailProvider, setEmailProvider } from './provider';
import { drainOutbox, DRAIN_OUTBOX_JOB, scheduleOutboxDrain } from './drain';
import { enqueue, listJobs, claimNext } from '@/lib/jobs/queue';
import { runJob } from '@/lib/jobs/worker';

/**
 * Email delivery.
 *
 * This is the path that did not exist: mail was queued from P7 onward and
 * nothing ever sent it. These tests assert the loop closes — and, just as
 * importantly, that a permanent failure does not spin forever.
 */

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const migration of MIGRATIONS) db.exec(migration.sql);
  return db;
}

let db: Database.Database;
let provider: MemoryEmailProvider;

beforeEach(() => {
  db = freshDb();
  provider = new MemoryEmailProvider();
  setEmailProvider(provider);
});

afterEach(() => {
  // Restore the configured provider so one test cannot leak into another.
  setEmailProvider(null);
});

describe('drainOutbox', () => {
  it('sends what is queued and marks it sent', async () => {
    queueEmail('a@example.com', 'One', 'body one', db);
    queueEmail('b@example.com', 'Two', 'body two', db);

    const result = await drainOutbox(25, db);

    expect(result).toMatchObject({ attempted: 2, sent: 2, failed: 0 });
    expect(provider.sent.map((m) => m.to)).toEqual([
      'a@example.com',
      'b@example.com',
    ]);

    // Marked, so a second drain does not send them again.
    expect(pendingEmails(50, db)).toHaveLength(0);
  });

  /**
   * The queue is at-least-once, so a drain can run twice over the same rows.
   * Each message is marked immediately after its own send rather than in a
   * batch at the end, so a replay resends nothing already delivered.
   */
  it('is idempotent across repeated runs', async () => {
    queueEmail('a@example.com', 'One', 'body', db);

    await drainOutbox(25, db);
    const second = await drainOutbox(25, db);

    expect(second.attempted).toBe(0);
    expect(provider.sent).toHaveLength(1);
  });

  it('leaves a failed message pending rather than losing it', async () => {
    queueEmail('a@example.com', 'One', 'body', db);
    provider.failWith = { error: 'upstream 500', retryable: true };

    const result = await drainOutbox(25, db);

    expect(result).toMatchObject({ sent: 0, failed: 1, retryable: true });
    // Still there: a message that failed to send must not vanish.
    expect(pendingEmails(50, db)).toHaveLength(1);
  });

  /**
   * A rejected address will fail identically on every attempt. Marking that
   * non-retryable is what stops the queue filling with work that can never
   * succeed.
   */
  it('does not ask for a retry when the failure is permanent', async () => {
    queueEmail('not-an-address', 'One', 'body', db);
    provider.failWith = { error: '422 invalid recipient', retryable: false };

    const result = await drainOutbox(25, db);

    expect(result.failed).toBe(1);
    expect(result.retryable).toBe(false);
  });
});

describe('the drain job', () => {
  it('runs the drain and completes', async () => {
    queueEmail('a@example.com', 'One', 'body', db);
    enqueue(DRAIN_OUTBOX_JOB, {}, {}, db);

    const job = claimNext(db)!;
    expect(await runJob(job, db)).toBe('done');
    expect(provider.sent).toHaveLength(1);
  });

  it('retries when every send failed transiently', async () => {
    queueEmail('a@example.com', 'One', 'body', db);
    provider.failWith = { error: 'timeout', retryable: true };

    enqueue(DRAIN_OUTBOX_JOB, {}, {}, db);
    const job = claimNext(db)!;

    // Throwing is how a handler tells the queue to back off and try again.
    expect(await runJob(job, db)).toBe('retry');
  });

  it('completes rather than retrying when the failure is permanent', async () => {
    queueEmail('bad', 'One', 'body', db);
    provider.failWith = { error: '422', retryable: false };

    enqueue(DRAIN_OUTBOX_JOB, {}, {}, db);
    const job = claimNext(db)!;

    // Nothing to gain from retrying a malformed address; the row stays in the
    // outbox for a human to look at.
    expect(await runJob(job, db)).toBe('done');
  });

  /**
   * Ten invitations in a minute should not create ten identical drain jobs.
   * The dedupe key collapses a burst into one pending sweep.
   */
  it('collapses a burst of schedule calls into one job', () => {
    const first = scheduleOutboxDrain(db);
    const second = scheduleOutboxDrain(db);

    expect(second).toBe(first);
    expect(listJobs('pending', 10, db)).toHaveLength(1);
  });
});
