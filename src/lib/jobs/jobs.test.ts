import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '@/lib/db/migrations';
import {
  backoffSeconds,
  claimNext,
  completeJob,
  enqueue,
  failJob,
  listJobs,
  queueStats,
} from './queue';
import { drain, registerHandler, runJob } from './worker';
import { emit, recentEvents, subscribe, subscribersOf } from './events';

/**
 * The job queue and the event log.
 *
 * These tests build their own in-memory database rather than mocking, because
 * the behaviour under test IS the SQL: the claim is a conditional UPDATE, the
 * dedupe is a partial unique index, and mocking either would test the mock.
 */

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const migration of MIGRATIONS) db.exec(migration.sql);
  return db;
}

let db: Database.Database;

beforeEach(() => {
  db = freshDb();
});

describe('enqueue', () => {
  it('creates a claimable job', () => {
    enqueue('test.job', { value: 1 }, {}, db);

    const claimed = claimNext(db);
    expect(claimed?.type).toBe('test.job');
    expect(claimed?.payload).toEqual({ value: 1 });
    expect(claimed?.attempts).toBe(1);
  });

  it('does not claim a job whose delay has not elapsed', () => {
    enqueue('later', {}, { delaySeconds: 60 }, db);
    expect(claimNext(db)).toBeNull();
  });

  /**
   * The dedupe key must survive the job completing.
   *
   * A partial unique index on (type, dedupe_key) alone would let a FINISHED
   * job hold its key forever, so a recurring key like 'outbox' could be
   * enqueued exactly once in the lifetime of the database and every later
   * attempt would silently return the old, already-done row. The index is
   * therefore scoped to unfinished statuses.
   */
  it('collapses duplicates while pending, and frees the key once done', () => {
    const first = enqueue('dedupe.me', {}, { dedupeKey: 'k' }, db);
    const second = enqueue('dedupe.me', {}, { dedupeKey: 'k' }, db);

    expect(second).toBe(first);
    expect(listJobs('pending', 100, db)).toHaveLength(1);

    const claimed = claimNext(db)!;
    completeJob(claimed.id, db);

    const third = enqueue('dedupe.me', {}, { dedupeKey: 'k' }, db);
    expect(third).not.toBe(first);
  });
});

describe('claiming', () => {
  /**
   * Two workers polling together must not both get the same row. The claim is
   * one conditional UPDATE for exactly this reason — a SELECT then UPDATE lets
   * both pass the read.
   */
  it('hands a job to only one caller', () => {
    enqueue('once', {}, {}, db);

    const a = claimNext(db);
    const b = claimNext(db);

    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it('reclaims a job whose worker died holding the lease', () => {
    enqueue('stuck', {}, {}, db);
    const claimed = claimNext(db)!;

    // Nothing else can take it while the lease is fresh.
    expect(claimNext(db)).toBeNull();

    // Simulate the worker dying: the row stays 'running' with an old lock.
    db.prepare(
      `UPDATE jobs SET locked_at = datetime('now', '-1 hour') WHERE id = ?`,
    ).run(claimed.id);

    expect(claimNext(db)?.id).toBe(claimed.id);
  });
});

describe('failure handling', () => {
  it('backs off exponentially and caps', () => {
    expect(backoffSeconds(1)).toBe(4);
    expect(backoffSeconds(2)).toBe(16);
    expect(backoffSeconds(3)).toBe(64);
    // Capped, so a long-failing job does not schedule itself years out.
    expect(backoffSeconds(99)).toBe(3600);
  });

  it('retries until max attempts, then dead-letters and keeps the row', () => {
    enqueue('flaky', {}, { maxAttempts: 2 }, db);

    const first = claimNext(db)!;
    expect(failJob(first.id, 'boom', db)).toBe('retry');

    // Make the backoff elapse so the retry is claimable.
    db.prepare(`UPDATE jobs SET run_after = datetime('now', '-1 hour')`).run();

    const second = claimNext(db)!;
    expect(failJob(second.id, 'boom again', db)).toBe('dead');

    const dead = listJobs('dead', 10, db);
    expect(dead).toHaveLength(1);
    // The error is preserved: a queue that erases its failures cannot be
    // debugged, and the row is the only evidence the work was requested.
    expect(dead[0]?.lastError).toBe('boom again');
  });
});

describe('worker', () => {
  it('runs a handler and marks the job done', async () => {
    const seen: unknown[] = [];
    registerHandler('worker.ok', (payload) => {
      seen.push(payload);
    });

    enqueue('worker.ok', { a: 1 }, {}, db);
    const result = await drain(10, db);

    expect(result).toMatchObject({ processed: 1, succeeded: 1 });
    expect(seen).toEqual([{ a: 1 }]);
    expect(queueStats(db).done).toBe(1);
  });

  it('retries a throwing handler', async () => {
    registerHandler('worker.throws', () => {
      throw new Error('nope');
    });

    enqueue('worker.throws', {}, {}, db);
    const result = await drain(10, db);

    expect(result).toMatchObject({ processed: 1, retried: 1 });
    expect(listJobs('pending', 10, db)[0]?.lastError).toContain('nope');
  });

  /**
   * An unknown type is a PERMANENT failure. Retrying it five times cannot
   * help — no amount of waiting registers a handler — and the backoff would
   * only delay the moment someone notices.
   */
  it('dead-letters an unknown job type immediately', async () => {
    enqueue('nobody.handles.this', {}, {}, db);

    const job = claimNext(db)!;
    expect(await runJob(job, db)).toBe('dead');
    expect(queueStats(db).dead).toBe(1);
  });

  it('stops at the requested limit', async () => {
    registerHandler('worker.many', () => {});
    for (let i = 0; i < 5; i++) enqueue('worker.many', { i }, {}, db);

    expect((await drain(2, db)).processed).toBe(2);
    expect(queueStats(db).pending).toBe(3);
  });
});

describe('events', () => {
  it('records what happened', () => {
    emit('map.shared', { actorId: null, subjectType: 'map', subjectId: 'm1' }, db);

    const events = recentEvents({ type: 'map.shared' }, 10, db);
    expect(events).toHaveLength(1);
    expect(events[0]?.subjectId).toBe('m1');
  });

  /**
   * A subscriber is ENQUEUED, not called. A slow or throwing subscriber must
   * not be able to fail the request that emitted the event — an incidental
   * consequence should never break the primary action.
   */
  it('enqueues subscribers rather than calling them', () => {
    subscribe('thing.happened', 'react.to.thing');

    expect(subscribersOf('thing.happened')).toEqual(['react.to.thing']);

    emit('thing.happened', { payload: { id: 'x' } }, db);

    const queued = listJobs('pending', 10, db);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.type).toBe('react.to.thing');
    expect(queued[0]?.payload).toMatchObject({ id: 'x' });
  });

  it('emits nothing to the queue when nobody is listening', () => {
    emit('unheard.event', {}, db);
    expect(listJobs('pending', 10, db)).toHaveLength(0);
  });
});
