import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { search } from '@/lib/search/query';
import { EMPTY_FILTERS, type SearchFilters } from '@/lib/search/types';
import type { FamilyName } from '@/lib/styles/tokens.generated';
import type { NodeType } from '@/lib/map/types';

export const dynamic = 'force-dynamic';

const FAMILIES = [
  'create',
  'discover',
  'services',
  'people',
  'organise',
  'commerce',
] as const;

const TYPES = [
  'topic',
  'link',
  'note',
  'image',
  'date',
  'service',
  'page',
  'cluster',
] as const;

/**
 * GET /api/search
 *
 * Signed-out is allowed — the Community Map and public maps are searchable
 * without an account, and §24 measures arrival for people who do not have
 * one. The empty context simply matches nothing private.
 *
 * The context comes from the SESSION, never from a parameter. A `userId`
 * query param would be a search-as-anyone endpoint.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') ?? '';

  const session = await getSession();
  const ctx = {
    userId: session?.userId ?? '',
    isStaff: session?.isStaff ?? false,
  };

  const filters: SearchFilters = {
    ...EMPTY_FILTERS,
    families: parseList(url.searchParams.get('families'), FAMILIES) as FamilyName[],
    types: parseList(url.searchParams.get('types'), TYPES) as NodeType[],
    liveOnly: url.searchParams.get('live') === '1',
    group: (url.searchParams.get('group') as SearchFilters['group']) ?? 'all',
  };

  const response = search(ctx, query, filters);

  // Analytics is emitted by the CLIENT, not here. `track()` is the browser
  // facade; calling it server-side would record events against no session and
  // never reach the configured provider.

  return NextResponse.json(response, {
    headers: {
      // Results depend on who is asking. A shared cache here would serve one
      // person's permitted results to another, which is the leak this phase
      // is about.
      'Cache-Control': 'private, no-store',
      'Server-Timing': `search;dur=${response.ms}`,
    },
  });
}

/** Only known values survive, so a crafted parameter cannot reach the query. */
function parseList(raw: string | null, allowed: readonly string[]): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => allowed.includes(value));
}
