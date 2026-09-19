import { NextResponse } from 'next/server';
import { handle, preflight, API_VERSION, RATE_LIMIT } from '@/lib/api/gateway';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/me — who this key is, and what it may do.
 *
 * ── Why every API needs this endpoint ───────────────────────────────────────
 *
 * It is the one call a developer makes first, and the one they make when
 * something is refused. Without it, "why did I get a 403" is answered by
 * guesswork; with it, the answer is one request. It also gives an SDK a
 * cheap way to validate a key at start-up rather than on the first real call,
 * which is where a bad key otherwise surfaces — in production, mid-operation.
 *
 * Requires no scope beyond a valid key. A key that cannot ask what it is would
 * be a key nobody could debug.
 */
export async function GET(request: Request) {
  return handle(request, {}, ({ authed }) =>
    NextResponse.json({
      data: {
        keyId: authed.key.id,
        keyPrefix: authed.key.prefix,
        name: authed.key.name,
        scopes: authed.key.scopes,
        /*
         * The owner's id, not their email.
         *
         * A key is very often held by a third party the owner installed. It
         * needs to know WHICH account it is acting for, and it does not need
         * that account's email address to do so.
         */
        userId: authed.actor.userId,
        organizationId: authed.key.orgId,
        installationId: authed.key.installationId,
        expiresAt: authed.key.expiresAt,
        apiVersion: API_VERSION,
        rateLimit: { max: RATE_LIMIT.max, windowSeconds: RATE_LIMIT.windowSeconds },
      },
    }),
  );
}

export function OPTIONS() {
  return preflight();
}
