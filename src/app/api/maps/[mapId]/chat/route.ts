import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT, getMap } from '@/lib/db/repo';
import { publish } from '@/lib/collab/bus';
import {
  MAX_MESSAGE_LENGTH,
  extractNodeRef,
  latestEventId,
  listMessages,
  postMessage,
  roleOn,
} from '@/lib/collab/repo';

export const dynamic = 'force-dynamic';

/** GET — the thread. §15: "one thread per map". */
export async function GET(
  _request: Request,
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

  return NextResponse.json({ messages: listMessages(ctx, mapId) });
}

const schema = z.object({
  body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

/** POST — send. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in to post' }, { status: 401 });
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Write something first' }, { status: 400 });
  }

  /**
   * §15's hash mention is resolved HERE, against the map the sender can
   * actually see, rather than trusting a node id sent by the client.
   * Otherwise a message could carry a chip pointing into a map the reader has
   * no access to, and tapping it would be a probe for which ids exist.
   */
  const map = getMap(ctx, mapId);
  const nodeRef = map ? extractNodeRef(parsed.data.body, map.nodes) : null;

  const message = postMessage(ctx, mapId, parsed.data.body, nodeRef);
  if (!message) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Published AFTER the write has committed. The bus carries a nudge, and a
  // nudge that arrives before the row exists sends every listener to read
  // something that is not there yet.
  publish(mapId, latestEventId(mapId));

  return NextResponse.json({ message });
}
