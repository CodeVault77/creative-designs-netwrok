import { NextResponse } from 'next/server';
import { handle, preflight } from '@/lib/api/gateway';
import { apiListMaps } from '@/lib/api/resources';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/maps — the maps this key's owner can see.
 *
 * Owned and shared together, each row saying which. Two endpoints would make
 * "list everything" two calls that have to be merged, and every client would
 * write the same merge.
 */
export async function GET(request: Request) {
  return handle(request, { scopes: ['maps:read'] }, ({ authed, db }) =>
    NextResponse.json({ data: apiListMaps(authed.actor, db) }),
  );
}

export function OPTIONS() {
  return preflight();
}
