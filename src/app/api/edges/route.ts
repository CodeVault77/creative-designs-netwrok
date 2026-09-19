import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT } from '@/lib/db/repo';
import { EDGE_TYPES, createEdge, deleteEdge, edgesForMap } from '@/lib/graph/edges';
import { emit } from '@/lib/jobs/events';

export const dynamic = 'force-dynamic';

/**
 * Typed relationships between nodes.
 *
 * Thin on purpose. Authorisation, the cross-map rules and the duplicate check
 * all live in `lib/graph/edges` and are tested there; this route validates
 * shape and delegates.
 */

const createSchema = z.object({
  fromNodeId: z.string().min(1).max(64),
  toNodeId: z.string().min(1).max(64),
  // Derived from the module's own vocabulary rather than restated, so adding a
  // relationship kind does not require remembering to edit a second list.
  type: z.enum(EDGE_TYPES).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

function contextFrom(session: Awaited<ReturnType<typeof getSession>>) {
  return session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;
}

/** GET /api/edges?mapId=… — every relationship touching a map. */
export async function GET(request: Request) {
  const mapId = new URL(request.url).searchParams.get('mapId');
  if (!mapId) {
    return NextResponse.json({ error: 'mapId is required' }, { status: 400 });
  }

  const ctx = contextFrom(await getSession());

  /*
   * An empty list for a map you cannot see, not a 403 — `edgesForMap` already
   * returns nothing without `view`, and distinguishing "no edges" from "no
   * access" would confirm the map exists.
   */
  return NextResponse.json({ edges: edgesForMap(ctx, mapId) });
}

/** POST — link two nodes. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? 'Check the request' },
      { status: 400 },
    );
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };

  const result = createEdge(ctx, {
    fromNodeId: parsed.data.fromNodeId,
    toNodeId: parsed.data.toNodeId,
    ...(parsed.data.type ? { type: parsed.data.type } : {}),
    ...(parsed.data.payload ? { payload: parsed.data.payload } : {}),
  });

  if (!result.ok || !result.edge) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  /*
   * Emitted rather than acted on.
   *
   * Nothing subscribes to this yet, and that is the point: when a notification,
   * an agent trigger or a webhook needs to react to a new relationship, it
   * subscribes here instead of this route importing it.
   */
  emit('node.linked', {
    actorId: session.userId,
    subjectType: 'edge',
    subjectId: result.edge.id,
    payload: {
      mapId: result.edge.mapId,
      type: result.edge.type,
      fromNodeId: result.edge.fromNodeId,
      toNodeId: result.edge.toNodeId,
    },
  });

  return NextResponse.json({ edge: result.edge }, { status: 201 });
}

/** DELETE /api/edges?id=… */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const removed = deleteEdge(
    { userId: session.userId, isStaff: session.isStaff },
    id,
  );

  return NextResponse.json({ ok: removed }, { status: removed ? 200 : 404 });
}
