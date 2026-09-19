import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import { guardedAgent } from '@/lib/ingest/fetcher';
import { clientEnv } from '@/lib/env';
import { SIGNATURE_HEADER, sign } from './signature';
import { recordFailure, recordSuccess } from './endpoints';

/**
 * Sending one webhook.
 *
 * This module does the HTTP and records what happened. Deciding WHICH
 * endpoints hear about an event, and scheduling the work, is `fanout.ts` —
 * split that way because fan-out is a policy question (who may know this) and
 * delivery is a mechanism (sign these bytes, post them, write down the
 * result). Policy and mechanism in one file is how a retry ends up making a
 * permission decision.
 *
 * ── At-least-once, deduplicated by the receiver ─────────────────────────────
 *
 * The unique index on (endpoint, event) means one event produces one delivery
 * row per endpoint however often the fan-out runs. It does NOT promise
 * exactly-once over the wire: a receiver whose 200 is lost to a dropped
 * connection has processed a delivery we will retry. That is unavoidable in
 * any network protocol, so the payload carries a stable `id` and the SDK's
 * documentation tells receivers to key on it. Promising exactly-once would be
 * a lie that eventually costs someone a duplicated order.
 */

/** The queue job that performs a delivery. Handled in `fanout.ts`. */
export const DELIVERY_JOB = 'webhook.deliver';

/** A receiver gets this long to answer. */
export const TIMEOUT_MS = 8000;

export interface DeliveryPayload {
  id: string;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
}

/**
 * The exact bytes that are signed and sent.
 *
 * A named function rather than an inline `JSON.stringify`, because the
 * signature covers these bytes and a receiver verifies against the bytes it
 * received. Two places serialising "the same" object slightly differently is
 * the single most common cause of a signature mismatch nobody can reproduce —
 * so there is one place, and the test asserts the sent body equals it.
 */
export function serialisePayload(payload: DeliveryPayload): string {
  return JSON.stringify(payload);
}

export interface QueueResult {
  deliveryId: string;
  /**
   * False when this event already had a delivery row for this endpoint.
   *
   * Not an error — it is the deduplication working, and it is what makes the
   * whole fan-out path safe to run twice.
   */
  created: boolean;
}

/**
 * Record that an event is to be delivered to an endpoint.
 *
 * The row is written BEFORE the job is enqueued (by the caller), and its
 * unique index is the idempotency guarantee. Enqueuing first and recording
 * later would leave a window in which a repeat produces a second job.
 */
export function queueDelivery(
  endpointId: string,
  event: { id: string; type: string },
  db: Database = getDb(),
): QueueResult {
  const id = `whd_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  const written = db
    .prepare(
      `INSERT OR IGNORE INTO webhook_deliveries
         (id, endpoint_id, event_id, event_type)
       VALUES (?, ?, ?, ?)`,
    )
    .run(id, endpointId, event.id, event.type).changes;

  if (written > 0) return { deliveryId: id, created: true };

  /*
   * The insert was ignored, so a row already exists. Its id is returned rather
   * than the one just generated: callers use it to address the delivery, and
   * handing back an id that is not in the table would produce a job that can
   * never find its own row.
   */
  const existing = db
    .prepare(
      'SELECT id FROM webhook_deliveries WHERE endpoint_id = ? AND event_id = ?',
    )
    .get(endpointId, event.id) as { id: string } | undefined;

  return { deliveryId: existing?.id ?? id, created: false };
}

export interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
  /** Whether another attempt is worth making. */
  retryable: boolean;
}

/**
 * Sign, POST, and record the outcome on the delivery row.
 *
 * `fetchImpl` is injectable so the tests can drive every status code and
 * transport failure without a network. The default is the real `fetch` with
 * the SSRF-guarded dispatcher; a test passing its own implementation is
 * testing this function's logic, which is what it is for.
 */
export async function send(
  deliveryId: string,
  url: string,
  payload: DeliveryPayload,
  secret: string,
  db: Database = getDb(),
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const body = serialisePayload(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // Counted before the attempt, so a crash mid-flight still leaves evidence
  // that an attempt was made rather than silently repeating forever.
  db.prepare(
    'UPDATE webhook_deliveries SET attempts = attempts + 1 WHERE id = ?',
  ).run(deliveryId);

  let result: SendResult;

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: sign(body, secret),
        'x-cdn-event': payload.type,
        'x-cdn-delivery': deliveryId,
        'user-agent': `CreativeDesignNetworks-Webhooks/1.0 (+${clientEnv.NEXT_PUBLIC_SITE_URL})`,
      },
      body,
      signal: controller.signal,
      /*
       * `redirect: 'manual'` because a 302 defeats the address check: the URL
       * we vetted answers with a redirect to somewhere we would never have
       * allowed. A webhook receiver has no legitimate reason to redirect, so
       * refusing to follow one costs nothing real.
       */
      redirect: 'manual',
      // The SSRF-guarded dispatcher, exported by the ingest fetcher for
      // exactly this use. It refuses at connect time if DNS resolves to
      // anything private, which is the only defence against rebinding.
      dispatcher: guardedAgent,
    } as RequestInit & { dispatcher: unknown });

    if (response.status >= 200 && response.status < 300) {
      result = { ok: true, status: response.status, retryable: false };
    } else {
      /*
       * 4xx is permanent, with two exceptions. A 400 means the receiver
       * understood us and refused; repeating it changes nothing and adds load
       * to a server already saying no. But 408 and 429 are explicitly
       * temporary, and treating them as permanent drops events for a receiver
       * that is merely busy.
       */
      result = {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}`,
        retryable:
          response.status >= 500 ||
          response.status === 408 ||
          response.status === 429,
      };
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    /*
     * A blocked address is NOT retryable, unlike other transport errors. It is
     * a policy refusal — the address will still be private next time — and
     * retrying is five more connection attempts toward an internal host, which
     * is precisely what the guard exists to prevent.
     */
    const blocked = /private network|blocked/i.test(message);

    result = { ok: false, error: message.slice(0, 200), retryable: !blocked };
  } finally {
    clearTimeout(timer);
  }

  db.prepare(
    `UPDATE webhook_deliveries SET
       status = @status,
       response_status = @responseStatus,
       error = @error,
       delivered_at = CASE WHEN @ok = 1 THEN datetime('now') ELSE delivered_at END
     WHERE id = @id`,
  ).run({
    id: deliveryId,
    /*
     * A retryable failure stays `pending`, not `failed`. The queue has not
     * given up on it, and a row reading "failed" while a retry is scheduled
     * would make the delivery log disagree with what is about to happen.
     */
    status: result.ok ? 'delivered' : result.retryable ? 'pending' : 'failed',
    responseStatus: result.status ?? null,
    error: result.ok ? null : (result.error ?? 'failed'),
    ok: result.ok ? 1 : 0,
  });

  return result;
}

/**
 * Apply a send's outcome to the endpoint's consecutive-failure streak.
 *
 * Separate from `send` so that the delivery row and the endpoint's health are
 * updated by two explicit calls. They answer different questions — "what
 * happened to this message" and "is this endpoint still worth calling" — and
 * folding them together made the retry path update health once per attempt,
 * which disabled healthy endpoints during a receiver's brief outage.
 */
export function applyOutcome(
  endpointId: string,
  result: { ok: boolean; retryable: boolean },
  db: Database = getDb(),
): void {
  if (result.ok) recordSuccess(endpointId, db);
  else recordFailure(endpointId, db);
}

/**
 * Give up on a delivery for a reason that is not the receiver's fault.
 *
 * Used when the endpoint disappeared between fan-out and delivery. Marked
 * `failed` rather than deleted: the history is what an owner reads when asking
 * why an integration stopped, and a missing row answers nothing.
 */
export function abandon(
  deliveryId: string,
  reason: string,
  db: Database = getDb(),
): void {
  db.prepare(
    `UPDATE webhook_deliveries SET status = 'failed', error = ? WHERE id = ?`,
  ).run(reason.slice(0, 200), deliveryId);
}

/** The signing secret for an endpoint. Never leaves the server. */
export function secretForEndpoint(
  endpointId: string,
  db: Database = getDb(),
): string | null {
  const row = db
    .prepare('SELECT secret FROM webhook_endpoints WHERE id = ?')
    .get(endpointId) as { secret: string } | undefined;

  return row?.secret ?? null;
}

export interface DeliveryRow {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

interface RawDelivery {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  status: string;
  attempts: number;
  response_status: number | null;
  error: string | null;
  delivered_at: string | null;
  created_at: string;
}

function hydrate(row: RawDelivery): DeliveryRow {
  return {
    id: row.id,
    endpointId: row.endpoint_id,
    eventId: row.event_id,
    eventType: row.event_type,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.response_status,
    error: row.error,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
  };
}

export function getDelivery(
  deliveryId: string,
  db: Database = getDb(),
): DeliveryRow | null {
  const row = db
    .prepare('SELECT * FROM webhook_deliveries WHERE id = ?')
    .get(deliveryId) as RawDelivery | undefined;

  return row ? hydrate(row) : null;
}

/** Recent deliveries for one endpoint, so an owner can debug their receiver. */
export function deliveriesFor(
  endpointId: string,
  limit = 50,
  db: Database = getDb(),
): DeliveryRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM webhook_deliveries WHERE endpoint_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(endpointId, limit) as RawDelivery[];

  return rows.map(hydrate);
}
