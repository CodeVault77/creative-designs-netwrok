import 'server-only';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import { enqueue } from '@/lib/jobs/queue';
import { registerHandler } from '@/lib/jobs/worker';
import { subscribe } from '@/lib/jobs/events';
import {
  DELIVERY_JOB,
  abandon,
  applyOutcome,
  queueDelivery,
  secretForEndpoint,
  send,
  type DeliveryPayload,
} from './delivery';
import { subscribersFor } from './endpoints';

/**
 * Turning events into webhook deliveries.
 *
 * ── Which events leave the building ─────────────────────────────────────────
 *
 * An allow-list, not everything. The event log is internal machinery and
 * gains types freely; a webhook is a published contract that third parties
 * build on and that we then cannot change. Fanning out every event would
 * publish the internal log by accident and make every future internal event a
 * breaking change to somebody's integration.
 *
 * The list mirrors `TRIGGERABLE_EVENTS` in `lib/agents/repo.ts` for the same
 * reason it exists there: a small, deliberate set of things that actually
 * happened to a user's own data.
 *
 * ── Whose webhooks fire ─────────────────────────────────────────────────────
 *
 * Only the OWNER's. An event carries an actor and a subject; the endpoints
 * that hear about it belong to the person whose data changed, which for these
 * events is the actor. A collaborator's endpoints do not fire, because "who
 * may know this happened" is a permission question and a delivery job is the
 * wrong place to be answering it — the API the receiver then calls answers it
 * properly, with the key owner's own authority.
 */

export const WEBHOOK_EVENTS: readonly string[] = [
  'map.created',
  'map.updated',
  'map.shared',
  'map.deleted',
  'node.created',
  'node.updated',
  'agent.run.completed',
  'agent.run.failed',
  'listing.published',
  'listing.ordered',
];

export function isWebhookEvent(type: string): boolean {
  return WEBHOOK_EVENTS.includes(type);
}

/** The job type that fans one event out to every subscribed endpoint. */
export const FANOUT_JOB = 'webhook.fanout';

/**
 * Fan one event out.
 *
 * Returns the number of deliveries actually created — repeats create none,
 * which is what makes the whole path safe to run twice.
 */
export function fanout(
  event: {
    id: string;
    type: string;
    actorId: string | null;
    createdAt: string;
    payload: Record<string, unknown>;
  },
  db: Database = getDb(),
): number {
  if (!isWebhookEvent(event.type) || !event.actorId) return 0;

  const endpoints = subscribersFor(event.type, event.actorId, db);
  let created = 0;

  for (const endpoint of endpoints) {
    const queued = queueDelivery(endpoint.id, event, db);

    // An existing row means this event already reached this endpoint, or is
    // already queued to. Enqueuing again would be a second POST.
    if (!queued.created) continue;

    enqueue(
      DELIVERY_JOB,
      {
        deliveryId: queued.deliveryId,
        endpointId: endpoint.id,
        url: endpoint.url,
        eventId: event.id,
        eventType: event.type,
        createdAt: event.createdAt,
        data: event.payload,
      },
      { dedupeKey: `deliver:${queued.deliveryId}` },
      db,
    );

    created += 1;
  }

  return created;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * The fan-out job.
 *
 * Subscribed to every allow-listed event type, so emitting one schedules this
 * rather than doing the work inline. A slow or unreachable receiver must never
 * be able to delay the request that caused the event.
 */
registerHandler(FANOUT_JOB, (payload, db) => {
  const eventId = asString(payload.eventId);
  const eventType = asString(payload.eventType);

  if (!eventId || !eventType) return;

  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
    | {
        id: string;
        type: string;
        actor_id: string | null;
        payload: string;
        created_at: string;
      }
    | undefined;

  if (!row) return;

  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.payload);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    data = {};
  }

  fanout(
    {
      id: row.id,
      type: row.type,
      actorId: row.actor_id,
      createdAt: row.created_at,
      payload: data,
    },
    db,
  );
});

/**
 * The delivery job.
 *
 * Throws on a retryable failure so the queue's existing backoff and
 * dead-letter machinery handles it — reimplementing retry here would be a
 * second, worse copy of `queue.ts`. A permanent failure returns normally,
 * because there is nothing to retry and dead-lettering a 400 would fill the
 * dead-letter queue with receivers who simply disagree with us.
 */
registerHandler(DELIVERY_JOB, async (payload, db) => {
  const deliveryId = asString(payload.deliveryId);
  const endpointId = asString(payload.endpointId);
  const url = asString(payload.url);

  if (!deliveryId || !endpointId || !url) return;

  const secret = secretForEndpoint(endpointId, db);

  if (!secret) {
    // The endpoint was deleted between fan-out and delivery. Nothing to sign
    // with and nobody to send to; not a failure worth retrying.
    abandon(deliveryId, 'Endpoint no longer exists', db);
    return;
  }

  const body: DeliveryPayload = {
    id: asString(payload.eventId),
    type: asString(payload.eventType),
    createdAt: asString(payload.createdAt),
    data:
      payload.data &&
      typeof payload.data === 'object' &&
      !Array.isArray(payload.data)
        ? (payload.data as Record<string, unknown>)
        : {},
  };

  const result = await send(deliveryId, url, body, secret, db);

  applyOutcome(endpointId, result, db);

  if (!result.ok && result.retryable) {
    throw new Error(result.error ?? 'Delivery failed');
  }
});

/**
 * Connect the allow-listed events to the fan-out job, at module load.
 *
 * `subscribe` is backed by a Set, so importing this module twice binds once.
 */
for (const eventType of WEBHOOK_EVENTS) {
  subscribe(eventType, FANOUT_JOB);
}
