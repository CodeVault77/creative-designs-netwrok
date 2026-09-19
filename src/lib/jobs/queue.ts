import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';

/**
 * Durable background work.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Nothing in this application could previously run asynchronously. The clearest
 * symptom was the email outbox: `queueEmail` wrote rows, `pendingEmails` and
 * `markSent` existed, and NOTHING ever called them — every invite, every
 * acknowledgement, every confirmation sat in a table forever while the user was
 * told it had been sent.
 *
 * ── Why a table and not a queue service ─────────────────────────────────────
 *
 * The database is already the durability boundary. A separate broker would add
 * a second thing to deploy, a second thing to back up, and a second thing that
 * can be up while the other is down — for a workload measured in dozens of jobs
 * an hour. When throughput demands a broker, `enqueue` is the only function
 * that has to change.
 *
 * ── This is NOT an exactly-once queue ───────────────────────────────────────
 *
 * It is at-least-once: a worker that dies mid-job leaves the row locked, and
 * the lease expiry hands it to another worker that runs it again. **Handlers
 * must be idempotent.** `drainOutbox` is written that way — it marks each
 * message sent inside the same step that sends it, so a replay skips what
 * already went out.
 */

export type JobStatus = 'pending' | 'running' | 'done' | 'dead';

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAfter: string;
  createdAt: string;
}

interface JobRow {
  id: string;
  type: string;
  payload: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  run_after: string;
  created_at: string;
}

function hydrate(row: JobRow): Job {
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.payload);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    // A job whose payload will not parse cannot be run, but it must still be
    // listable — otherwise the one row you need to diagnose is the one row you
    // cannot see.
    payload = {};
  }

  return {
    id: row.id,
    type: row.type,
    payload,
    status: row.status as JobStatus,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    runAfter: row.run_after,
    createdAt: row.created_at,
  };
}

export interface EnqueueOptions {
  /** Seconds to wait before the job first becomes claimable. */
  delaySeconds?: number;
  maxAttempts?: number;
  /**
   * Idempotency key, unique per type.
   *
   * Two requests that both try to enqueue "send the welcome email for user X"
   * should produce one job. Enforced by a partial unique index, not by a prior
   * SELECT, so concurrent callers cannot both pass the check.
   */
  dedupeKey?: string;
}

/**
 * Add work to the queue.
 *
 * Returns the existing job's id when `dedupeKey` collides, so callers can treat
 * "already queued" as success — which it is.
 */
export function enqueue(
  type: string,
  payload: Record<string, unknown> = {},
  options: EnqueueOptions = {},
  db: Database = getDb(),
): string {
  const id = randomUUID();
  const delay = Math.max(0, options.delaySeconds ?? 0);

  try {
    db.prepare(
      `INSERT INTO jobs (id, type, payload, max_attempts, dedupe_key, run_after)
       VALUES (@id, @type, @payload, @maxAttempts, @dedupeKey,
               datetime('now', '+' || @delay || ' seconds'))`,
    ).run({
      id,
      type,
      payload: JSON.stringify(payload),
      maxAttempts: options.maxAttempts ?? 5,
      dedupeKey: options.dedupeKey ?? null,
      delay,
    });
    return id;
  } catch (cause) {
    if (options.dedupeKey && String(cause).includes('UNIQUE')) {
      /*
       * Scoped to unfinished jobs, matching the partial index that raised the
       * conflict. A completed job with the same key is not the one we just
       * collided with, and returning its id would tell the caller their work
       * is queued when it is not.
       */
      const existing = db
        .prepare(
          `SELECT id FROM jobs
            WHERE type = ? AND dedupe_key = ?
              AND status IN ('pending', 'running')
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get(type, options.dedupeKey) as { id: string } | undefined;
      if (existing) return existing.id;
    }
    throw cause;
  }
}

/**
 * How long a claimed job may stay 'running' before another worker may take it.
 *
 * A worker that is killed between claiming and finishing leaves the row locked.
 * Without a lease that job is stuck forever in a state nothing retries — the
 * failure mode that looks like "the queue silently stopped".
 */
export const LEASE_SECONDS = 300;

/**
 * Claim one job.
 *
 * The claim is a single conditional UPDATE rather than SELECT-then-UPDATE.
 * Two workers polling at the same moment both pass a prior SELECT; only one can
 * win a `WHERE status = 'pending'`.
 */
export function claimNext(db: Database = getDb()): Job | null {
  const row = db
    .prepare(
      `UPDATE jobs
          SET status = 'running',
              locked_at = datetime('now'),
              attempts = attempts + 1,
              updated_at = datetime('now')
        WHERE id = (
          SELECT id FROM jobs
           WHERE (status = 'pending' AND run_after <= datetime('now'))
              -- Reclaim a job whose worker died holding the lease.
              OR (status = 'running'
                  AND locked_at <= datetime('now', '-' || @lease || ' seconds'))
           ORDER BY run_after
           LIMIT 1
        )
        RETURNING *`,
    )
    .get({ lease: LEASE_SECONDS }) as JobRow | undefined;

  return row ? hydrate(row) : null;
}

/** Mark a job finished. */
export function completeJob(id: string, db: Database = getDb()): void {
  db.prepare(
    `UPDATE jobs SET status = 'done', last_error = NULL,
                     updated_at = datetime('now')
      WHERE id = ?`,
  ).run(id);
}

/**
 * Exponential backoff with a ceiling.
 *
 * 4s, 16s, 64s, 256s, then capped. A tight retry loop against a provider that
 * is rate-limiting you is how a transient failure becomes a ban.
 */
export function backoffSeconds(attempts: number): number {
  return Math.min(4 ** Math.max(1, attempts), 3600);
}

/**
 * Record a failure: retry with backoff, or dead-letter once attempts run out.
 *
 * Dead rows are KEPT, never deleted. A queue that erases its failures is a
 * queue that cannot be debugged, and the row is the only evidence the work was
 * ever requested.
 */
export function failJob(
  id: string,
  error: string,
  db: Database = getDb(),
): 'retry' | 'dead' {
  const row = db
    .prepare('SELECT attempts, max_attempts FROM jobs WHERE id = ?')
    .get(id) as { attempts: number; max_attempts: number } | undefined;

  if (!row) return 'dead';

  const message = error.slice(0, 1000);

  if (row.attempts >= row.max_attempts) {
    db.prepare(
      `UPDATE jobs SET status = 'dead', last_error = @error,
                       updated_at = datetime('now')
        WHERE id = @id`,
    ).run({ id, error: message });
    return 'dead';
  }

  db.prepare(
    `UPDATE jobs
        SET status = 'pending',
            last_error = @error,
            run_after = datetime('now', '+' || @delay || ' seconds'),
            updated_at = datetime('now')
      WHERE id = @id`,
  ).run({ id, error: message, delay: backoffSeconds(row.attempts) });

  return 'retry';
}

export function listJobs(
  status: JobStatus | null = null,
  limit = 100,
  db: Database = getDb(),
): Job[] {
  const rows = db
    .prepare(
      `SELECT * FROM jobs
        WHERE (@status IS NULL OR status = @status)
        ORDER BY created_at DESC LIMIT @limit`,
    )
    .all({ status, limit }) as JobRow[];

  return rows.map(hydrate);
}

export interface QueueStats {
  pending: number;
  running: number;
  done: number;
  dead: number;
}

/** Counts by status. The one number an operator checks is `dead`. */
export function queueStats(db: Database = getDb()): QueueStats {
  const rows = db
    .prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status')
    .all() as { status: string; n: number }[];

  const stats: QueueStats = { pending: 0, running: 0, done: 0, dead: 0 };
  for (const row of rows) {
    if (row.status in stats) stats[row.status as keyof QueueStats] = row.n;
  }
  return stats;
}
