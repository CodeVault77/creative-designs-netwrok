import 'server-only';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { formatScopes, narrow, parseScopes, type Scope } from './scopes';

/**
 * API keys.
 *
 * ── The shape of a key, and why ─────────────────────────────────────────────
 *
 *     cdn_live_a1b2c3d4_<43 base64url characters>
 *     └──┬───┘ └───┬──┘  └────────────┬─────────┘
 *     environment  prefix           secret
 *
 * The ENVIRONMENT segment exists because the single most expensive mistake
 * with an API key is using a production one against test data, or committing
 * one believing it was a test key. Making the environment the first thing a
 * human reads costs eight characters.
 *
 * The PREFIX is stored in clear and uniquely indexed. It turns verification
 * into one indexed lookup followed by one constant-time comparison, instead of
 * a scan comparing the presented secret against every hash in the table — a
 * scan whose cost grows with the number of keys and which is therefore a
 * denial-of-service vector as well as being slow. The prefix is also what the
 * UI shows so a person can tell two keys apart, which matters because the
 * secret is displayed exactly once.
 *
 * The SECRET is 32 random bytes and is stored only as a SHA-256 digest. A
 * leaked database yields no working credentials.
 *
 * ── Why SHA-256 and not a password hash ─────────────────────────────────────
 *
 * Passwords need bcrypt/argon because they are low-entropy and human-chosen,
 * so an offline attack can guess them. A 256-bit random secret cannot be
 * guessed, so the slow hash buys nothing — and it would cost a KDF's worth of
 * work on EVERY API request, which is a real budget on a hot path. Sessions in
 * this codebase are stored the same way for the same reason.
 */

/** Never `cdn_test_` in production, and never `cdn_live_` outside it. */
export type KeyEnvironment = 'live' | 'test';

export interface ApiKey {
  id: string;
  prefix: string;
  userId: string;
  orgId: string | null;
  name: string;
  scopes: Scope[];
  installationId: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface KeyRow {
  id: string;
  prefix: string;
  secret_hash: string;
  user_id: string;
  org_id: string | null;
  name: string;
  scopes: string;
  installation_id: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

function hydrate(row: KeyRow): ApiKey {
  return {
    id: row.id,
    prefix: row.prefix,
    userId: row.user_id,
    orgId: row.org_id,
    name: row.name,
    scopes: parseScopes(row.scopes),
    installationId: row.installation_id,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

function digest(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export interface IssuedKey {
  key: ApiKey;
  /**
   * The full key, in clear.
   *
   * Returned exactly once, from the call that created it, and never stored.
   * Every caller must treat this as the only chance to show it to a person.
   */
  secret: string;
}

export interface IssueResult {
  ok: boolean;
  issued?: IssuedKey;
  error?: string;
}

/** The most keys one account may hold at once. */
export const MAX_KEYS_PER_USER = 25;

/**
 * Mint a key for the caller.
 *
 * ── A key can never exceed its owner ────────────────────────────────────────
 *
 * `scopes` is what the key MAY be asked to do, and every request it makes is
 * still authorised as `ctx.userId` through the ordinary repositories. There is
 * deliberately no way to issue a key for somebody else: a support flow that
 * could mint credentials for another account is an account takeover with a
 * form in front of it.
 */
export function issueKey(
  ctx: AuthContext,
  input: {
    name: string;
    scopes: readonly Scope[];
    orgId?: string | null;
    /** ISO timestamp. Optional, and recommended for anything automated. */
    expiresAt?: string | null;
    installationId?: string | null;
    environment?: KeyEnvironment;
  },
  db: Database = getDb(),
): IssueResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };

  const scopes = narrow(input.scopes, input.scopes);
  if (scopes.length === 0) {
    /*
     * A key with no scopes can do nothing, which sounds harmless and is not:
     * it is a credential in circulation that looks like access. Refusing it
     * means every key in the table answers "what is this for".
     */
    return { ok: false, error: 'Choose at least one permission' };
  }

  const live = (
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL',
      )
      .get(ctx.userId) as { n: number }
  ).n;

  if (live >= MAX_KEYS_PER_USER) {
    return { ok: false, error: 'Revoke an unused key first' };
  }

  const environment = input.environment ?? 'live';
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const full = `cdn_${environment}_${prefix}_${secret}`;
  const id = `key_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  db.prepare(
    `INSERT INTO api_keys
       (id, prefix, secret_hash, user_id, org_id, name, scopes,
        installation_id, expires_at)
     VALUES (@id, @prefix, @hash, @userId, @orgId, @name, @scopes,
             @installationId, @expiresAt)`,
  ).run({
    id,
    prefix,
    hash: digest(secret),
    userId: ctx.userId,
    orgId: input.orgId ?? null,
    name: input.name.trim().slice(0, 80) || 'Untitled key',
    scopes: formatScopes(scopes),
    installationId: input.installationId ?? null,
    expiresAt: input.expiresAt ?? null,
  });

  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as KeyRow;

  return { ok: true, issued: { key: hydrate(row), secret: full } };
}

export type AuthFailure =
  'malformed' | 'unknown' | 'revoked' | 'expired' | 'insufficient_scope';

export interface AuthedKey {
  key: ApiKey;
  /**
   * The owner's context, for the ordinary repositories.
   *
   * `isStaff` is deliberately FALSE regardless of who owns the key. Staff
   * authority is the ability to read across ownership, and there is no reason
   * for a long-lived automated credential to hold it — a leaked staff key
   * would read every map in the system. Staff act through a session, in a
   * browser, one action at a time.
   */
  actor: AuthContext;
}

export interface AuthResult {
  ok: boolean;
  authed?: AuthedKey;
  failure?: AuthFailure;
}

/**
 * Parse and verify a presented key.
 *
 * Returns a coarse failure kind rather than a message: the route turns it into
 * a response, and the difference between "unknown" and "revoked" is useful in
 * a log and must never reach the caller, who would learn whether a prefix they
 * guessed exists.
 */
export function authenticate(
  presented: string,
  db: Database = getDb(),
): AuthResult {
  const match = /^cdn_(live|test)_([0-9a-f]{8})_([A-Za-z0-9_-]{20,})$/.exec(
    presented.trim(),
  );

  if (!match) return { ok: false, failure: 'malformed' };

  const [, , prefix, secret] = match;
  if (!prefix || !secret) return { ok: false, failure: 'malformed' };

  const row = db.prepare('SELECT * FROM api_keys WHERE prefix = ?').get(prefix) as
    KeyRow | undefined;

  if (!row) return { ok: false, failure: 'unknown' };

  /*
   * Constant-time comparison over the DIGESTS, not the secrets.
   *
   * Both digests are the same length by construction, which matters:
   * timingSafeEqual throws on a length mismatch, and a thrown exception is
   * itself a timing signal and a 500 rather than a 401.
   */
  const presentedDigest = Buffer.from(digest(secret), 'hex');
  const storedDigest = Buffer.from(row.secret_hash, 'hex');

  if (
    presentedDigest.length !== storedDigest.length ||
    !timingSafeEqual(presentedDigest, storedDigest)
  ) {
    return { ok: false, failure: 'unknown' };
  }

  if (row.revoked_at) return { ok: false, failure: 'revoked' };

  if (row.expires_at) {
    /*
     * Expiry is compared IN SQL.
     *
     * SQLite writes UTC with a space separator, and `new Date('2026-01-01
     * 00:00:00')` is parsed as LOCAL time by every JS engine. Comparing in
     * JavaScript therefore shifts every expiry by the server's offset — which
     * is how a fresh token reads as already expired west of UTC. The same bug
     * was found and fixed in password reset; it is fixed the same way here.
     */
    const expired = (
      db
        .prepare("SELECT (datetime('now') >= datetime(?)) AS gone")
        .get(row.expires_at) as { gone: number }
    ).gone;

    if (expired) return { ok: false, failure: 'expired' };
  }

  return {
    ok: true,
    authed: {
      key: hydrate(row),
      actor: { userId: row.user_id, isStaff: false },
    },
  };
}

/**
 * Record that a key was used.
 *
 * Separate from `authenticate` so that verification stays a pure read: a
 * write on the authentication path would take SQLite's write lock on every
 * API request, including the ones that are about to be refused.
 */
export function touchKey(keyId: string, db: Database = getDb()): void {
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(
    keyId,
  );
}

export function listKeys(ctx: AuthContext, db: Database = getDb()): ApiKey[] {
  if (!ctx.userId) return [];

  const rows = db
    .prepare(
      `SELECT * FROM api_keys WHERE user_id = ?
        ORDER BY revoked_at IS NOT NULL, created_at DESC`,
    )
    .all(ctx.userId) as KeyRow[];

  return rows.map(hydrate);
}

export interface RevokeResult {
  ok: boolean;
  error?: string;
}

/**
 * Revoke a key. Takes effect on the next request, everywhere.
 *
 * Scoped to the caller's own keys in the WHERE clause rather than by reading
 * the row and comparing — the check and the write are then one statement and
 * cannot disagree.
 */
export function revokeKey(
  ctx: AuthContext,
  keyId: string,
  db: Database = getDb(),
): RevokeResult {
  const changed = db
    .prepare(
      `UPDATE api_keys SET revoked_at = datetime('now')
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .run(keyId, ctx.userId).changes;

  return changed > 0 ? { ok: true } : { ok: false, error: 'Not found' };
}

/** Revoke every key an installation owns. Called when a plugin is removed. */
export function revokeInstallationKeys(
  installationId: string,
  db: Database = getDb(),
): number {
  return db
    .prepare(
      `UPDATE api_keys SET revoked_at = datetime('now')
        WHERE installation_id = ? AND revoked_at IS NULL`,
    )
    .run(installationId).changes;
}

/** Record a completed request, for attribution and rate limiting. */
export function recordRequest(
  keyId: string,
  method: string,
  path: string,
  status: number,
  db: Database = getDb(),
): void {
  db.prepare(
    `INSERT INTO api_requests (id, key_id, method, path, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(randomUUID(), keyId, method.slice(0, 10), path.slice(0, 200), status);
}

/** Requests a key has made inside a window. Drives the per-key rate limit. */
export function requestsInWindow(
  keyId: string,
  seconds: number,
  db: Database = getDb(),
): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM api_requests
          WHERE key_id = ? AND created_at >= datetime('now', ?)`,
      )
      .get(keyId, `-${Math.max(1, Math.round(seconds))} seconds`) as { n: number }
  ).n;
}

/**
 * Drop request rows older than a day.
 *
 * The table is an operational log, not an audit trail — the audit question
 * ("what did this key change") is answered by `events`, which is append-only
 * and never pruned. Keeping request rows forever would grow the busiest table
 * in the system without anyone deciding to.
 */
export function pruneRequests(db: Database = getDb()): number {
  return db
    .prepare(
      "DELETE FROM api_requests WHERE created_at < datetime('now', '-1 day')",
    )
    .run().changes;
}
