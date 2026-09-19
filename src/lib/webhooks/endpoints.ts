import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { checkUrl } from '@/lib/ingest/ssrf';

/**
 * Outbound webhook endpoints.
 *
 * ── The URL is attacker-controlled, and that is the whole problem ───────────
 *
 * Everywhere else in this codebase a URL we fetch came from a person pasting a
 * link they want to read. Here, a URL is supplied by someone who wants OUR
 * server to make a request to it — which is server-side request forgery with a
 * form in front of it. Point an endpoint at `http://169.254.169.254/` and the
 * cloud metadata service answers with credentials; point it at an internal
 * host and you have a port scanner behind the firewall.
 *
 * So the URL is checked TWICE, in two different ways, because either one alone
 * is insufficient:
 *
 *   1. `checkUrl` here, when the endpoint is created — protocol, port,
 *      credentials, blocked hostnames, literal private addresses. This is
 *      static and catches the obvious cases at the moment a human is present
 *      to read the refusal.
 *
 *   2. `guardedAgent` at DELIVERY time — resolves DNS and refuses if ANY
 *      returned address is private. Step 1 cannot do this, because
 *      `evil.example.com` is a perfectly public name today and can resolve to
 *      127.0.0.1 tomorrow. That is DNS rebinding, and only a check at connect
 *      time catches it.
 *
 * ── The secret is stored in clear, unlike every other secret here ───────────
 *
 * Sessions, API keys and reset tokens are all stored hashed. This one cannot
 * be: producing an HMAC requires the key material itself, and we are the party
 * that signs. Storing a digest would leave nothing to sign with.
 *
 * It is also a materially smaller risk. A webhook secret authenticates US TO
 * THE RECEIVER; it grants no access to anything here. Someone holding it can
 * forge a message that appears to come from us to one endpoint whose owner
 * chose it — bad, and not the same as holding a credential to this system.
 */

export interface WebhookEndpoint {
  id: string;
  ownerId: string;
  url: string;
  /**
   * The signing secret — present ONLY on the object returned by
   * `createEndpoint`, never on one from `listEndpoints`.
   *
   * Optional in the type rather than split across two types, because the two
   * are the same thing at different moments and a second interface would be
   * copied field for field. The test asserts the absence, which is the part
   * that actually needs guarding.
   */
  secret?: string;
  /** Event types, or ['*']. */
  events: string[];
  description: string;
  active: boolean;
  failures: number;
  disabledAt: string | null;
  installationId: string | null;
  createdAt: string;
}

interface EndpointRow {
  id: string;
  owner_id: string;
  url: string;
  secret: string;
  events: string;
  description: string;
  active: number;
  failures: number;
  disabled_at: string | null;
  installation_id: string | null;
  created_at: string;
}

function hydrate(row: EndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    ownerId: row.owner_id,
    url: row.url,
    events: row.events.split(/\s+/).filter(Boolean),
    description: row.description,
    active: row.active === 1,
    failures: row.failures,
    disabledAt: row.disabled_at,
    installationId: row.installation_id,
    createdAt: row.created_at,
  };
}

/** Consecutive failures before an endpoint is switched off. */
export const FAILURE_LIMIT = 15;

/** The most endpoints one account may register. */
export const MAX_ENDPOINTS = 20;

export interface CreateResult {
  ok: boolean;
  /** On success, carries `secret` — the only time it is ever returned. */
  endpoint?: WebhookEndpoint;
  error?: string;
}

export function createEndpoint(
  ctx: AuthContext,
  input: {
    url: string;
    events: readonly string[];
    description?: string;
    installationId?: string | null;
  },
  db: Database = getDb(),
): CreateResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };

  const verdict = checkUrl(input.url);
  if (!verdict.ok) {
    // The reason is passed through: the owner typed this URL and can fix it,
    // and "that address points inside a private network" is far more useful
    // than a generic refusal.
    return { ok: false, error: verdict.detail ?? 'That URL cannot be used.' };
  }

  const events = [...new Set(input.events.map((event) => event.trim()))]
    .filter(Boolean)
    .slice(0, 40);

  if (events.length === 0) {
    /*
     * An endpoint subscribed to nothing is never called, so it looks broken
     * rather than empty. Refusing means every row in the table is one someone
     * expects traffic on.
     */
    return { ok: false, error: 'Choose at least one event' };
  }

  const live = (
    db
      .prepare('SELECT COUNT(*) AS n FROM webhook_endpoints WHERE owner_id = ?')
      .get(ctx.userId) as { n: number }
  ).n;

  if (live >= MAX_ENDPOINTS) {
    return { ok: false, error: 'Delete an endpoint first' };
  }

  const id = `whe_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;

  db.prepare(
    `INSERT INTO webhook_endpoints
       (id, owner_id, url, secret, events, description, installation_id)
     VALUES (@id, @ownerId, @url, @secret, @events, @description, @installationId)`,
  ).run({
    id,
    ownerId: ctx.userId,
    url: input.url.trim(),
    secret,
    events: events.join(' '),
    description: (input.description ?? '').slice(0, 200),
    installationId: input.installationId ?? null,
  });

  const row = db
    .prepare('SELECT * FROM webhook_endpoints WHERE id = ?')
    .get(id) as EndpointRow;

  return { ok: true, endpoint: { ...hydrate(row), secret } };
}

export function listEndpoints(
  ctx: AuthContext,
  db: Database = getDb(),
): WebhookEndpoint[] {
  if (!ctx.userId) return [];

  const rows = db
    .prepare(
      'SELECT * FROM webhook_endpoints WHERE owner_id = ? ORDER BY created_at DESC',
    )
    .all(ctx.userId) as EndpointRow[];

  return rows.map(hydrate);
}

export interface EndpointResult {
  ok: boolean;
  error?: string;
}

export function deleteEndpoint(
  ctx: AuthContext,
  endpointId: string,
  db: Database = getDb(),
): EndpointResult {
  const changed = db
    .prepare('DELETE FROM webhook_endpoints WHERE id = ? AND owner_id = ?')
    .run(endpointId, ctx.userId).changes;

  return changed > 0 ? { ok: true } : { ok: false, error: 'Not found' };
}

/** Turn an endpoint back on after it was auto-disabled, clearing the count. */
export function reactivate(
  ctx: AuthContext,
  endpointId: string,
  db: Database = getDb(),
): EndpointResult {
  const changed = db
    .prepare(
      `UPDATE webhook_endpoints
          SET active = 1, failures = 0, disabled_at = NULL
        WHERE id = ? AND owner_id = ?`,
    )
    .run(endpointId, ctx.userId).changes;

  return changed > 0 ? { ok: true } : { ok: false, error: 'Not found' };
}

/** Remove every endpoint an installation owns. Called when a plugin is removed. */
export function deleteInstallationEndpoints(
  installationId: string,
  db: Database = getDb(),
): number {
  return db
    .prepare('DELETE FROM webhook_endpoints WHERE installation_id = ?')
    .run(installationId).changes;
}

/**
 * Endpoints that should receive an event type.
 *
 * Not scoped by an AuthContext: the caller is the fan-out job, which has
 * already established whose data changed. Taking a ctx here would suggest a
 * permission decision is being made, and it is not — that decision was made
 * upstream, deliberately, and is documented in `fanout.ts`.
 *
 * Matching is exact or `*`. There is no wildcard prefix form: `map.*` looks
 * obvious until someone asks whether it matches `map.node.created`, and a
 * subscription nobody can predict is one that silently misses events.
 */
export function subscribersFor(
  eventType: string,
  ownerId: string,
  db: Database = getDb(),
): WebhookEndpoint[] {
  const rows = db
    .prepare('SELECT * FROM webhook_endpoints WHERE owner_id = ? AND active = 1')
    .all(ownerId) as EndpointRow[];

  return rows
    .map(hydrate)
    .filter(
      (endpoint) =>
        endpoint.events.includes('*') || endpoint.events.includes(eventType),
    );
}

/** Record a success: clears the consecutive-failure count. */
export function recordSuccess(endpointId: string, db: Database = getDb()): void {
  db.prepare('UPDATE webhook_endpoints SET failures = 0 WHERE id = ?').run(
    endpointId,
  );
}

/**
 * Record a failure, disabling the endpoint once it has failed enough times.
 *
 * Consecutive, not cumulative: an endpoint with occasional blips over a year
 * is healthy and would eventually be switched off by a cumulative count. The
 * signal worth acting on is "this has been failing continuously", which is
 * what a counter reset by every success measures.
 */
export function recordFailure(
  endpointId: string,
  db: Database = getDb(),
): { disabled: boolean } {
  const row = db
    .prepare(
      `UPDATE webhook_endpoints
          SET failures = failures + 1,
              active = CASE WHEN failures + 1 >= @limit THEN 0 ELSE active END,
              disabled_at = CASE
                WHEN failures + 1 >= @limit THEN datetime('now')
                ELSE disabled_at END
        WHERE id = @id
        RETURNING active`,
    )
    .get({ id: endpointId, limit: FAILURE_LIMIT }) as
    { active: number } | undefined;

  return { disabled: row?.active === 0 };
}
