import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT } from '@/lib/db/repo';
import { feed, getInterests } from '@/lib/watch/repo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/watch/feed — §13 step 4.
 *
 * Interests come from the query string when present and from the profile
 * otherwise, so a signed-out visitor can browse a selection they have not
 * saved and a signed-in one does not have to re-pick on every visit.
 */
export async function GET(request: Request) {
  const session = await getSession();
  const ctx = session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;

  const params = new URL(request.url).searchParams;

  const explicit = (params.get('tags') ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  const tags = explicit.length > 0 ? explicit : getInterests(ctx);

  const page = feed(ctx, {
    tags,
    limit: Number(params.get('limit') ?? 8),
    cursor: params.get('cursor'),
    savedOnly: params.get('saved') === '1',
  });

  return NextResponse.json({ ...page, tags });
}
