import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/auth/api';
import { heartbeat, listLocks, listPresence, roleOn } from '@/lib/collab/repo';

export const dynamic = 'force-dynamic';

const schema = z.object({
  selectedId: z.string().max(60).nullable().optional(),
});

/**
 * POST /api/maps/[mapId]/presence — the heartbeat.
 *
 * §15: "Presence: avatar stack in the top bar; a coloured ring on nodes
 * another person has selected. No live cursors in MVP."
 *
 * A heartbeat with a TTL rather than a count of open sockets: counting
 * connections means a crashed tab stays "present" until some timeout you then
 * have to invent anyway, so the timeout is the design.
 *
 * Returns presence AND locks together, because the client wants both on the
 * same cadence, and two requests on a repeating timer is twice the cost for
 * the same information.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;
  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  const ctx = { userId: session.userId, isStaff: session.isStaff };
  if (!roleOn(ctx, mapId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let selectedId: string | null = null;
  try {
    const parsed = schema.safeParse(await request.json());
    if (parsed.success) selectedId = parsed.data.selectedId ?? null;
  } catch {
    // A heartbeat with no body is still a heartbeat.
  }

  heartbeat(ctx, mapId, selectedId);

  return NextResponse.json({
    present: listPresence(ctx, mapId),
    locks: listLocks(ctx, mapId),
  });
}
