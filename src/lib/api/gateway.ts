import 'server-only';
import { NextResponse } from 'next/server';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import {
  authenticate,
  recordRequest,
  requestsInWindow,
  touchKey,
  type AuthedKey,
} from './keys';
import { covers, type Scope } from './scopes';

/**
 * The public API gateway.
 *
 * Every `/api/v1` route goes through `handle`. That is not tidiness — it is
 * the only way the five things below are true of ALL of them rather than of
 * whichever ones a person remembered:
 *
 *   1. the key is verified, and never a session cookie (see below);
 *   2. the scopes the route needs are actually held;
 *   3. the rate limit is applied and reported in headers;
 *   4. the response shape is the same, including for errors;
 *   5. the request is recorded against the key.
 *
 * ── Why a session cookie is not accepted here ───────────────────────────────
 *
 * `/api/v1` authenticates by header ONLY. A browser attaches cookies to
 * cross-site requests automatically, so an API that also accepted a session
 * would be callable by any page the user happens to visit — classic CSRF, on
 * every endpoint at once. A key must be presented deliberately, which is
 * exactly the property that makes it safe to serve this API cross-origin.
 *
 * The application's own screens keep using the existing `/api/*` routes with
 * their session; those are same-origin and not this surface. Two audiences,
 * two doors.
 */

/** The current public version. Present in the path so a v2 can coexist. */
export const API_VERSION = 'v1';

/** Requests per key per window. */
export const RATE_LIMIT = { max: 600, windowSeconds: 60 } as const;

export interface RouteContext {
  authed: AuthedKey;
  request: Request;
  db: Database;
}

export interface RouteOptions {
  /** Scopes the caller must hold. Empty means authentication is enough. */
  scopes?: readonly Scope[];
}

/**
 * A consistent error body.
 *
 * `code` is stable and machine-readable; `message` is for a human reading a
 * log and may change. An SDK branches on the code, never on the prose — which
 * is a promise this shape makes rather than a convention it hopes for.
 */
export function apiError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

/**
 * CORS for the public API.
 *
 * Wide open, deliberately and safely: authentication is by explicit header, so
 * a browser cannot be tricked into making an authenticated call the way it can
 * with cookies. `Authorization` is not a CORS-safelisted header, so any
 * cross-origin call carrying one is preflighted and must be allowed here.
 *
 * This does NOT mean keys belong in browsers — a key shipped to a browser is a
 * key given to everyone who opens the page. It means a third party's own
 * server-rendered tooling and local development are not blocked for a reason
 * that protects nobody.
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** Pull the key out of `Authorization: Bearer …`, or the header alias. */
function presentedKey(request: Request): string | null {
  const header = request.headers.get('authorization');

  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1];
    // A bare key in Authorization is a common mistake and harmless to accept.
    return header.trim();
  }

  return request.headers.get('x-api-key');
}

/**
 * Run a public API route.
 *
 * The handler receives an already-authorised context and returns a response.
 * Everything before and after it happens here, once, for every route.
 */
export async function handle(
  request: Request,
  options: RouteOptions,
  handler: (ctx: RouteContext) => Promise<NextResponse> | NextResponse,
  db: Database = getDb(),
): Promise<NextResponse> {
  const path = new URL(request.url).pathname;
  const presented = presentedKey(request);

  const withHeaders = (response: NextResponse, keyId?: string): NextResponse => {
    for (const [name, value] of Object.entries(CORS_HEADERS)) {
      response.headers.set(name, value);
    }
    response.headers.set('X-API-Version', API_VERSION);
    if (keyId) response.headers.set('X-Request-Key', keyId);
    return response;
  };

  if (!presented) {
    return withHeaders(
      apiError(401, 'missing_key', 'Send an API key in the Authorization header.'),
    );
  }

  const result = authenticate(presented, db);

  if (!result.ok || !result.authed) {
    /*
     * One status and one message for every authentication failure.
     *
     * Distinguishing "unknown" from "revoked" or "expired" would confirm that
     * a guessed prefix exists — and the caller cannot act differently on any
     * of them anyway. The distinction is kept in the log, where it is useful
     * and harmless.
     */
    console.warn(`[api] auth failed on ${path}: ${result.failure}`);
    return withHeaders(apiError(401, 'invalid_key', 'That API key is not valid.'));
  }

  const { authed } = result;
  const required = options.scopes ?? [];

  if (!covers(authed.key.scopes, required)) {
    /*
     * 403 with the missing scope NAMED. This is one of the few places where
     * being specific helps rather than leaks: the caller already holds a valid
     * key, and telling a developer exactly which permission is missing is the
     * difference between a two-minute fix and an afternoon.
     */
    const missing = required.filter((scope) => !authed.key.scopes.includes(scope));

    return withHeaders(
      apiError(403, 'insufficient_scope', 'This key is missing a permission.', {
        required: [...required],
        missing,
      }),
      authed.key.id,
    );
  }

  const used = requestsInWindow(authed.key.id, RATE_LIMIT.windowSeconds, db);

  if (used >= RATE_LIMIT.max) {
    const response = withHeaders(
      apiError(429, 'rate_limited', 'Too many requests. Slow down.'),
      authed.key.id,
    );
    response.headers.set('Retry-After', String(RATE_LIMIT.windowSeconds));
    response.headers.set('X-RateLimit-Remaining', '0');

    // Recorded, so a client hammering a closed door still counts against the
    // window rather than resetting it by being refused.
    recordRequest(authed.key.id, request.method, path, 429, db);
    return response;
  }

  let response: NextResponse;

  try {
    response = await handler({ authed, request, db });
  } catch (cause) {
    /*
     * The error is logged in full and never returned.
     *
     * A stack trace from a database driver names tables, columns and file
     * paths. The caller gets a stable code they can branch on and nothing they
     * can map the system with.
     */
    console.error(`[api] ${request.method} ${path} failed:`, cause);
    response = apiError(500, 'internal', 'Something went wrong on our side.');
  }

  recordRequest(authed.key.id, request.method, path, response.status, db);
  touchKey(authed.key.id, db);

  const out = withHeaders(response, authed.key.id);
  out.headers.set('X-RateLimit-Limit', String(RATE_LIMIT.max));
  out.headers.set(
    'X-RateLimit-Remaining',
    String(Math.max(0, RATE_LIMIT.max - used - 1)),
  );

  return out;
}

/**
 * Read and size-check a JSON body.
 *
 * A public API is called by code, and code sends whatever it was told to. The
 * cap is here rather than at each route because "the one endpoint that forgot"
 * is the one that gets a 40MB body.
 */
export async function readJson(
  request: Request,
  maxBytes = 256 * 1024,
): Promise<{ ok: boolean; value?: unknown; error?: NextResponse }> {
  const declared = Number(request.headers.get('content-length') ?? '0');

  if (declared > maxBytes) {
    return {
      ok: false,
      error: apiError(413, 'too_large', 'That request body is too large.'),
    };
  }

  const text = await request.text();

  if (text.length > maxBytes) {
    // Content-Length can lie or be absent under chunked encoding, so the
    // actual body is measured too.
    return {
      ok: false,
      error: apiError(413, 'too_large', 'That request body is too large.'),
    };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      error: apiError(400, 'invalid_json', 'The body is not valid JSON.'),
    };
  }
}
