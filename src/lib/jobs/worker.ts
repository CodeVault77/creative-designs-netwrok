import 'server-only';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import { claimNext, completeJob, failJob, type Job } from './queue';

/**
 * The runner.
 *
 * A handler registry plus a loop that claims, runs, and records the outcome.
 * Deliberately small: everything hard (leases, backoff, dead-lettering) lives
 * in `queue.ts`, so a handler is just an async function that either returns or
 * throws.
 *
 * ── Handlers must be idempotent ─────────────────────────────────────────────
 *
 * The queue is at-least-once. A worker killed between doing the work and
 * recording success leaves the row locked, and the lease expiry gives it to
 * another worker. A handler that cannot safely run twice will eventually run
 * twice anyway.
 */

export type JobHandler = (
  payload: Record<string, unknown>,
  db: Database,
) => Promise<void> | void;

const handlers = new Map<string, JobHandler>();

export function registerHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

export function registeredTypes(): string[] {
  return [...handlers.keys()].sort();
}

export interface DrainResult {
  processed: number;
  succeeded: number;
  retried: number;
  dead: number;
}

/**
 * Run one job. Exported so a test can drive a single step deterministically
 * rather than racing a loop.
 */
export async function runJob(
  job: Job,
  db: Database = getDb(),
): Promise<'done' | 'retry' | 'dead'> {
  const handler = handlers.get(job.type);

  if (!handler) {
    /*
     * An unknown type is a permanent failure, not a transient one.
     *
     * Retrying it five times cannot help — no amount of waiting registers a
     * handler — and the backoff would just delay the moment someone notices.
     * It goes straight to dead-letter with a message that names the problem.
     */
    failJob(job.id, `No handler registered for job type "${job.type}"`, db);
    db.prepare(`UPDATE jobs SET status = 'dead' WHERE id = ?`).run(job.id);
    return 'dead';
  }

  try {
    await handler(job.payload, db);
    completeJob(job.id, db);
    return 'done';
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return failJob(job.id, message, db);
  }
}

/**
 * Drain up to `max` jobs.
 *
 * Bounded rather than "until empty" on purpose: this runs inside a request
 * handler that a scheduler calls, and an unbounded loop would hold that request
 * open for as long as work keeps arriving. The scheduler calling again is the
 * correct way to do more.
 */
export async function drain(
  max = 25,
  db: Database = getDb(),
): Promise<DrainResult> {
  const result: DrainResult = { processed: 0, succeeded: 0, retried: 0, dead: 0 };

  for (let i = 0; i < max; i++) {
    const job = claimNext(db);
    if (!job) break;

    result.processed++;
    const outcome = await runJob(job, db);

    if (outcome === 'done') result.succeeded++;
    else if (outcome === 'retry') result.retried++;
    else result.dead++;
  }

  return result;
}
