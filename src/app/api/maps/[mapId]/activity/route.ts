import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT } from '@/lib/db/repo';
import { listActivity, roleOn } from '@/lib/collab/repo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/maps/[mapId]/activity — §14's "who changed what, when".
 *
 * "Append-only log. Cheap to build, disproportionately trust-building."
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;
  const session = await getSession();
  const ctx = session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;

  if (!roleOn(ctx, mapId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const search = new URL(request.url).searchParams;
  const actor = search.get('actor');
  const action = search.get('action');

  return NextResponse.json({
    activity: listActivity(ctx, mapId, {
      ...(actor ? { actorId: actor } : {}),
      ...(action ? { action } : {}),
    }),
  });
}
