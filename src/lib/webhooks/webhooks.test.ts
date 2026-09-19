import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createUser } from '@/lib/db/repo';
import { emit } from '@/lib/jobs/events';
import { listJobs } from '@/lib/jobs/queue';
import {
  FAILURE_LIMIT,
  createEndpoint,
  deleteEndpoint,
  listEndpoints,
  reactivate,
  recordFailure,
  recordSuccess,
  subscribersFor,
} from './endpoints';
import { MAX_AGE_SECONDS, sign, verify } from './signature';
import {
  applyOutcome,
  deliveriesFor,
  getDelivery,
  queueDelivery,
  send,
  serialisePayload,
  type DeliveryPayload,
} from './delivery';
import { WEBHOOK_EVENTS, fanout, isWebhookEvent } from './fanout';

// The SDK's verifier, tested against the signer that produces what it reads.
// A publisher and a published verifier that disagree is a bug nobody finds
// until a third party reports it, so the two are checked against each other.
import { verifyWebhook } from '../../../sdk/index';

/**
 * Webhook tests.
 *
 * Three things can go badly wrong here, and each has its own block:
 *
 *   SSRF        an endpoint is a URL a stranger makes our server fetch, on a
 *               schedule, from inside our network.
 *   FORGERY     a receiver that cannot tell our delivery from someone else's
 *               is worse off than one receiving nothing.
 *   DUPLICATES  at-least-once delivery is correct; delivering the same event
 *               twice because the fan-out ran twice is not.
 */

let db: Database;
let owner: { userId: string; isStaff: boolean };

beforeEach(() => {
  db = createTestDb();

  createUser(
    {
      id: 'u_owner',
      email: 'owner@example.com',
      passwordHash: 'x',
      handle: 'owner',
      displayName: 'Owner',
    },
    db,
  );

  owner = { userId: 'u_owner', isStaff: false };
});

// ----------------------------------------------------------------------- SSRF

describe('an endpoint URL is checked against the SSRF policy', () => {
  const blocked: [string, string][] = [
    ['http://127.0.0.1/hook', 'loopback'],
    ['http://localhost/hook', 'loopback by name'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['http://10.0.0.5/hook', 'private range'],
    ['http://192.168.1.1/hook', 'private range'],
    ['http://buildserver/hook', 'a bare label only a private resolver answers'],
    ['https://user:pass@example.com/hook', 'credentials in the URL'],
    ['file:///etc/passwd', 'not a web protocol'],
  ];

  it.each(blocked)('refuses %s (%s)', (url) => {
    const result = createEndpoint(owner, { url, events: ['*'] }, db);

    expect(result.ok).toBe(false);
    expect(listEndpoints(owner, db)).toHaveLength(0);
  });

  it('accepts an ordinary public https URL', () => {
    const result = createEndpoint(
      owner,
      { url: 'https://example.com/hooks/cdn', events: ['map.created'] },
      db,
    );

    expect(result.ok).toBe(true);
  });
});

describe('creating an endpoint', () => {
  it('returns the secret once and never again', () => {
    const created = createEndpoint(
      owner,
      { url: 'https://example.com/hook', events: ['*'] },
      db,
    );

    expect(created.endpoint?.secret).toMatch(/^whsec_/);
    expect(listEndpoints(owner, db)[0]?.secret).toBeUndefined();
  });

  it('refuses an endpoint subscribed to nothing', () => {
    // An endpoint that can never fire is a configuration that looks like it
    // works.
    expect(
      createEndpoint(owner, { url: 'https://example.com/hook', events: [] }, db).ok,
    ).toBe(false);
  });

  it('will not let one person delete another’s endpoint', () => {
    createUser(
      {
        id: 'u_other',
        email: 'o@example.com',
        passwordHash: 'x',
        handle: 'other',
        displayName: 'Other',
      },
      db,
    );

    const created = createEndpoint(
      owner,
      { url: 'https://example.com/hook', events: ['*'] },
      db,
    );

    const result = deleteEndpoint(
      { userId: 'u_other', isStaff: false },
      created.endpoint!.id,
      db,
    );

    expect(result.ok).toBe(false);
    expect(listEndpoints(owner, db)).toHaveLength(1);
  });
});

describe('subscription matching', () => {
  it('matches an exact event type', () => {
    createEndpoint(
      owner,
      { url: 'https://example.com/a', events: ['map.created'] },
      db,
    );

    expect(subscribersFor('map.created', 'u_owner', db)).toHaveLength(1);
    expect(subscribersFor('map.deleted', 'u_owner', db)).toHaveLength(0);
  });

  it('matches everything for a wildcard', () => {
    createEndpoint(owner, { url: 'https://example.com/a', events: ['*'] }, db);

    expect(subscribersFor('anything.at.all', 'u_owner', db)).toHaveLength(1);
  });

  it('does not deliver another person’s events', () => {
    createEndpoint(owner, { url: 'https://example.com/a', events: ['*'] }, db);

    expect(subscribersFor('map.created', 'u_someone_else', db)).toHaveLength(0);
  });

  it('skips a disabled endpoint', () => {
    const created = createEndpoint(
      owner,
      { url: 'https://example.com/a', events: ['*'] },
      db,
    );

    for (let attempt = 0; attempt < FAILURE_LIMIT; attempt += 1) {
      recordFailure(created.endpoint!.id, db);
    }

    expect(subscribersFor('map.created', 'u_owner', db)).toHaveLength(0);
  });
});

describe('failure handling', () => {
  it('disables an endpoint after enough consecutive failures', () => {
    const created = createEndpoint(
      owner,
      { url: 'https://example.com/a', events: ['*'] },
      db,
    );

    for (let attempt = 1; attempt < FAILURE_LIMIT; attempt += 1) {
      expect(recordFailure(created.endpoint!.id, db).disabled).toBe(false);
    }

    expect(recordFailure(created.endpoint!.id, db).disabled).toBe(true);
    expect(listEndpoints(owner, db)[0]?.active).toBe(false);
  });

  it('resets the streak on any success', () => {
    const created = createEndpoint(
      owner,
      { url: 'https://example.com/a', events: ['*'] },
      db,
    );

    for (let attempt = 0; attempt < FAILURE_LIMIT - 1; attempt += 1) {
      recordFailure(created.endpoint!.id, db);
    }

    recordSuccess(created.endpoint!.id, db);

    // The streak is CONSECUTIVE failures. An endpoint that works most of the
    // time must not be disabled by an accumulated total.
    expect(recordFailure(created.endpoint!.id, db).disabled).toBe(false);
  });

  it('lets the owner switch a disabled endpoint back on', () => {
    const created = createEndpoint(
      owner,
      { url: 'https://example.com/a', events: ['*'] },
      db,
    );

    for (let attempt = 0; attempt < FAILURE_LIMIT; attempt += 1) {
      recordFailure(created.endpoint!.id, db);
    }

    expect(reactivate(owner, created.endpoint!.id, db).ok).toBe(true);

    const endpoint = listEndpoints(owner, db)[0];
    expect(endpoint?.active).toBe(true);
    expect(endpoint?.failures).toBe(0);
  });
});

// ------------------------------------------------------------------ signature

describe('signatures', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ id: 'evt_1', type: 'map.created' });

  it('verifies what it signs', () => {
    expect(verify(body, sign(body, secret), secret).ok).toBe(true);
  });

  it('rejects a body that changed by one byte', () => {
    const signature = sign(body, secret);

    expect(verify(`${body} `, signature, secret).failure).toBe('mismatch');
  });

  it('rejects the wrong secret', () => {
    expect(verify(body, sign(body, secret), 'whsec_other').failure).toBe(
      'mismatch',
    );
  });

  it('rejects a replay from outside the window', () => {
    const now = 1_700_000_000;
    const old = sign(body, secret, now - MAX_AGE_SECONDS - 1);

    expect(verify(body, old, secret, now).failure).toBe('stale');
  });

  it('rejects a timestamp from the future by the same margin', () => {
    /*
     * The age check is on the ABSOLUTE difference. A one-sided check rejects
     * honest traffic from a receiver whose clock runs slow while accepting a
     * forged future timestamp indefinitely.
     */
    const now = 1_700_000_000;
    const ahead = sign(body, secret, now + MAX_AGE_SECONDS + 1);

    expect(verify(body, ahead, secret, now).failure).toBe('stale');
  });

  it('rejects a malformed header rather than throwing', () => {
    expect(verify(body, 'garbage', secret).failure).toBe('malformed');
    expect(verify(body, 't=abc,v1=x', secret).failure).toBe('malformed');
  });

  it('is verified by the SDK we publish', async () => {
    // The signer and the published verifier must agree. If they ever diverge,
    // the first person to find out should not be a third party.
    const signature = sign(body, secret);
    const event = await verifyWebhook(body, signature, secret);

    expect(event.id).toBe('evt_1');
  });

  it('is rejected by the SDK when the secret is wrong', async () => {
    await expect(
      verifyWebhook(body, sign(body, secret), 'whsec_wrong'),
    ).rejects.toThrow(/mismatch/i);
  });
});

// ------------------------------------------------------------------- delivery

describe('delivery', () => {
  const payload: DeliveryPayload = {
    id: 'evt_1',
    type: 'map.created',
    createdAt: '2026-01-01 00:00:00',
    data: { mapId: 'map_1' },
  };

  /*
   * A REAL endpoint, not a made-up id.
   *
   * The first version of this block used `'whe_1'` and every delivery test
   * failed on the foreign key — which is the schema working. A delivery row
   * pointing at an endpoint that does not exist is a row nothing can ever
   * send, and letting the tests create one would have tested a state
   * production cannot reach.
   */
  let endpointId: string;

  beforeEach(() => {
    const created = createEndpoint(
      owner,
      { url: 'https://example.com/a', events: ['*'] },
      db,
    );
    endpointId = created.endpoint!.id;
  });

  it('records one delivery per (endpoint, event), however often it is queued', () => {
    const first = queueDelivery(
      endpointId,
      { id: 'evt_1', type: 'map.created' },
      db,
    );
    const second = queueDelivery(
      endpointId,
      { id: 'evt_1', type: 'map.created' },
      db,
    );

    expect(first.created).toBe(true);
    // The property the whole fan-out depends on: a repeat is not a second POST.
    expect(second.created).toBe(false);
    expect(second.deliveryId).toBe(first.deliveryId);
  });

  it('marks a 2xx delivered', async () => {
    const queued = queueDelivery(endpointId, payload, db);

    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 }));

    const result = await send(
      queued.deliveryId,
      'https://example.com/a',
      payload,
      'whsec_x',
      db,
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.ok).toBe(true);
    expect(getDelivery(queued.deliveryId, db)?.status).toBe('delivered');
  });

  it('signs the exact bytes it sends', async () => {
    const queued = queueDelivery(endpointId, payload, db);
    let sentBody = '';
    let sentSignature = '';

    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      sentBody = String(init.body);
      sentSignature = String(
        (init.headers as Record<string, string>)['x-cdn-signature'],
      );
      return new Response('ok', { status: 200 });
    });

    await send(
      queued.deliveryId,
      'https://example.com/a',
      payload,
      'whsec_x',
      db,
      fetchImpl as unknown as typeof fetch,
    );

    // Verifying the SENT body, not a re-serialisation of the payload. This is
    // the bug every receiver hits, checked from the sending side.
    expect(sentBody).toBe(serialisePayload(payload));
    expect(verify(sentBody, sentSignature, 'whsec_x').ok).toBe(true);
  });

  it('does not retry a 4xx', async () => {
    const queued = queueDelivery(endpointId, payload, db);

    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('no', { status: 400 }));

    const result = await send(
      queued.deliveryId,
      'https://example.com/a',
      payload,
      'whsec_x',
      db,
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.retryable).toBe(false);
    expect(getDelivery(queued.deliveryId, db)?.status).toBe('failed');
  });

  it('retries a 5xx and a 429', async () => {
    for (const status of [500, 502, 429]) {
      // A distinct event id per status: the unique index means one endpoint
      // receives a given event once, which is the point of the index.
      const queued = queueDelivery(
        endpointId,
        { ...payload, id: `evt_${status}` },
        db,
      );
      const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status }));

      const result = await send(
        queued.deliveryId,
        'https://example.com/a',
        payload,
        'whsec_x',
        db,
        fetchImpl as unknown as typeof fetch,
      );

      expect(result.retryable).toBe(true);
      expect(getDelivery(queued.deliveryId, db)?.status).toBe('pending');
    }
  });

  it('retries a transport failure', async () => {
    const queued = queueDelivery(endpointId, payload, db);
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await send(
      queued.deliveryId,
      'https://example.com/a',
      payload,
      'whsec_x',
      db,
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.retryable).toBe(true);
    expect(getDelivery(queued.deliveryId, db)?.error).toContain('ECONNREFUSED');
  });

  it('counts attempts', async () => {
    const queued = queueDelivery(endpointId, payload, db);
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 500 }));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await send(
        queued.deliveryId,
        'https://example.com/a',
        payload,
        'whsec_x',
        db,
        fetchImpl as unknown as typeof fetch,
      );
    }

    expect(getDelivery(queued.deliveryId, db)?.attempts).toBe(3);
  });

  it('applies the outcome to the endpoint’s streak', () => {
    applyOutcome(endpointId, { ok: false, retryable: true }, db);
    expect(listEndpoints(owner, db)[0]?.failures).toBe(1);

    applyOutcome(endpointId, { ok: true, retryable: false }, db);
    expect(listEndpoints(owner, db)[0]?.failures).toBe(0);
  });
});

// -------------------------------------------------------------------- fan-out

describe('fan-out', () => {
  const event = {
    id: 'evt_1',
    type: 'map.created',
    actorId: 'u_owner',
    createdAt: '2026-01-01 00:00:00',
    payload: { mapId: 'map_1' },
  };

  it('only publishes allow-listed event types', () => {
    // The event log is internal machinery and gains types freely; a webhook is
    // a published contract. Fanning out everything would publish the log.
    expect(isWebhookEvent('map.created')).toBe(true);
    expect(isWebhookEvent('internal.cache.warmed')).toBe(false);
    expect(WEBHOOK_EVENTS.length).toBeGreaterThan(3);
  });

  it('creates a delivery and a job for a subscribed endpoint', () => {
    createEndpoint(
      owner,
      { url: 'https://example.com/a', events: ['map.created'] },
      db,
    );

    expect(fanout(event, db)).toBe(1);
    expect(
      listJobs(null, 10, db).some((job) => job.type === 'webhook.deliver'),
    ).toBe(true);
  });

  it('creates nothing on a second run of the same event', () => {
    createEndpoint(
      owner,
      { url: 'https://example.com/a', events: ['map.created'] },
      db,
    );

    expect(fanout(event, db)).toBe(1);
    // At-least-once delivery is correct. Delivering twice because the fan-out
    // ran twice is not.
    expect(fanout(event, db)).toBe(0);
  });

  it('ignores an event type nobody may subscribe to', () => {
    createEndpoint(owner, { url: 'https://example.com/a', events: ['*'] }, db);

    expect(fanout({ ...event, type: 'internal.thing' }, db)).toBe(0);
  });

  it('ignores an event with no actor', () => {
    // A system event has nobody's endpoints to fire.
    createEndpoint(owner, { url: 'https://example.com/a', events: ['*'] }, db);

    expect(fanout({ ...event, actorId: null }, db)).toBe(0);
  });

  it('schedules the fan-out job when an allow-listed event is emitted', () => {
    emit(
      'map.created',
      { actorId: 'u_owner', subjectType: 'map', subjectId: 'map_1' },
      db,
    );

    const jobs = listJobs(null, 20, db);
    expect(jobs.some((job) => job.type === 'webhook.fanout')).toBe(true);
  });
});

describe('delivery history', () => {
  it('is kept per endpoint', () => {
    const a = createEndpoint(
      owner,
      { url: 'https://example.com/a', events: ['*'] },
      db,
    ).endpoint!.id;

    const b = createEndpoint(
      owner,
      { url: 'https://example.com/b', events: ['*'] },
      db,
    ).endpoint!.id;

    queueDelivery(a, { id: 'evt_1', type: 'map.created' }, db);
    queueDelivery(a, { id: 'evt_2', type: 'map.updated' }, db);
    queueDelivery(b, { id: 'evt_3', type: 'map.updated' }, db);

    expect(deliveriesFor(a, 10, db)).toHaveLength(2);
    expect(deliveriesFor(b, 10, db)).toHaveLength(1);
  });

  it('goes with the endpoint when it is deleted', () => {
    // ON DELETE CASCADE. Delivery history for an endpoint nobody can see is
    // rows nothing will ever read again.
    const created = createEndpoint(
      owner,
      { url: 'https://example.com/a', events: ['*'] },
      db,
    ).endpoint!.id;

    queueDelivery(created, { id: 'evt_1', type: 'map.created' }, db);
    deleteEndpoint(owner, created, db);

    expect(deliveriesFor(created, 10, db)).toHaveLength(0);
  });
});
