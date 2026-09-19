import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import { enqueue } from './queue';

/**
 * An append-only log of things that happened, and subscriptions to them.
 *
 * ── Why events and not direct calls ─────────────────────────────────────────
 *
 * Today, when a map is shared, the sharing code calls `queueEmail` directly.
 * That is fine for one consequence and unworkable for five: the emitter ends up
 * importing every subsystem that cares, and adding a consequence means editing
 * the thing that caused it. Emitting `map.shared` instead lets notifications,
 * analytics, an agent trigger and a webhook all attach without the sharing code
 * knowing any of them exist.
 *
 * ── Two things happen on emit ───────────────────────────────────────────────
 *
 * The event is WRITTEN (durable history, queryable, survives a restart) and
 * subscribers are ENQUEUED as jobs (retried, backed off, dead-lettered). It is
 * deliberately not "call the subscriber now": a slow or throwing subscriber
 * would otherwise fail the request that emitted the event, which makes an
 * incidental consequence able to break the primary action.
 */

export interface AppEvent {
  id: string;
  type: string;
  actorId: string | null;
  subjectType: string;
  subjectId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface EventRow {
  id: string;
  type: string;
  actor_id: string | null;
  subject_type: string;
  subject_id: string;
  payload: string;
  created_at: string;
}

function hydrate(row: EventRow): AppEvent {
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.payload);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    payload = {};
  }

  return {
    id: row.id,
    type: row.type,
    actorId: row.actor_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    payload,
    createdAt: row.created_at,
  };
}

/**
 * Subscriptions, as a map from event type to the job types to enqueue.
 *
 * A subscriber is named by its JOB type rather than by a function, so a
 * subscription survives a restart: the binding lives in the queue, not in the
 * memory of the process that happened to be running when the event fired.
 */
const subscriptions = new Map<string, Set<string>>();

export function subscribe(eventType: string, jobType: string): void {
  const existing = subscriptions.get(eventType) ?? new Set<string>();
  existing.add(jobType);
  subscriptions.set(eventType, existing);
}

export function subscribersOf(eventType: string): string[] {
  return [...(subscriptions.get(eventType) ?? [])].sort();
}

export interface EmitOptions {
  actorId?: string | null;
  subjectType?: string;
  subjectId?: string;
  payload?: Record<string, unknown>;
}

/** Record that something happened, and schedule whatever listens for it. */
export function emit(
  type: string,
  options: EmitOptions = {},
  db: Database = getDb(),
): string {
  const id = randomUUID();
  const payload = options.payload ?? {};

  db.prepare(
    `INSERT INTO events (id, type, actor_id, subject_type, subject_id, payload)
     VALUES (@id, @type, @actorId, @subjectType, @subjectId, @payload)`,
  ).run({
    id,
    type,
    actorId: options.actorId ?? null,
    subjectType: options.subjectType ?? '',
    subjectId: options.subjectId ?? '',
    payload: JSON.stringify(payload),
  });

  for (const jobType of subscribersOf(type)) {
    /*
     * The event id is the dedupe key.
     *
     * If emit is retried — a caller repeating a request, a replayed webhook —
     * the same event produces the same job rather than a duplicate consequence.
     */
    enqueue(
      jobType,
      { eventId: id, eventType: type, ...payload },
      { dedupeKey: `${id}:${jobType}` },
      db,
    );
  }

  return id;
}

export function recentEvents(
  filter: { type?: string; subjectType?: string; subjectId?: string } = {},
  limit = 100,
  db: Database = getDb(),
): AppEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM events
        WHERE (@type IS NULL OR type = @type)
          AND (@subjectType IS NULL OR subject_type = @subjectType)
          AND (@subjectId IS NULL OR subject_id = @subjectId)
        ORDER BY created_at DESC LIMIT @limit`,
    )
    .all({
      type: filter.type ?? null,
      subjectType: filter.subjectType ?? null,
      subjectId: filter.subjectId ?? null,
      limit,
    }) as EventRow[];

  return rows.map(hydrate);
}
