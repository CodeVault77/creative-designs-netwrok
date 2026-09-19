import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/auth/api';
import {
  deleteMap,
  getMap,
  NotWritableError,
  saveMap,
  VersionConflictError,
} from '@/lib/db/repo';
import { getRole } from '@/lib/db/sharing-repo';
import { buildSharePayload, NotVisibleError } from '@/lib/sharing/payload';
import { checkNodeQuota } from '@/lib/quotas';
import { nodeTypeDef } from '@/lib/nodes/registry';
import { publish } from '@/lib/collab/bus';
import { appendEvent, recordActivity } from '@/lib/collab/repo';

export const dynamic = 'force-dynamic';

const nodeSchema = z.object({
  id: z.string().min(1).max(128),
  map_id: z.string().min(1).max(128),
  parent_id: z.string().min(1).max(128).nullable(),
  slot: z.number().int().min(0).max(10_000),
  title: z.string().max(60),
  description: z.string().max(2000).optional(),
  family: z.enum([
    'create',
    'discover',
    'services',
    'people',
    'organise',
    'commerce',
  ]),
  /*
   * A bounded string, not an enum — the same leniency `icon` below already
   * gets, and for the same reason `lib/nodes/registry.ts` gives an unknown
   * type: "the row exists, and refusing to name it helps nobody."
   *
   * This WAS a fixed enum of the eight original types, and it is why
   * `product`, `order`, `invoice`, `contact`, `deal`, `task` and `milestone`
   * — all registered, tested and documented in `lib/nodes/packages.ts` —
   * could not actually be saved: the registry accepted them, the picker could
   * theoretically offer them, and this line 400'd every one anyway. An enum
   * here can only ever be a second copy of the registry's id list, and a copy
   * is a thing that goes stale. See `map/types.test.ts` for where the
   * corresponding closed `NodeType` union is now kept honest instead.
   */
  type: z.string().trim().min(1).max(64),
  status: z.enum(['active', 'inactive', 'coming_soon']),
  visibility: z.enum(['inherit', 'public', 'private']),
  icon: z.string().max(64).optional(),
  href: z.string().max(2048).optional(),
  weight: z.number().min(0).max(1),
  freeX: z.number().optional(),
  freeY: z.number().optional(),
  payload: z.record(z.unknown()).optional(),
});

const saveSchema = z.object({
  version: z.number().int().min(0),
  title: z.string().trim().min(1).max(60).optional(),
  family: z
    .enum(['create', 'discover', 'services', 'people', 'organise', 'commerce'])
    .optional(),
  visibility: z.enum(['private', 'link', 'public']).optional(),
  nodes: z.record(nodeSchema).optional(),
  rootId: z.string().min(1).max(128).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;

  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  const ctx = { userId: session.userId, isStaff: session.isStaff };
  const map = getMap(ctx, mapId);

  // The repository already applied the visibility predicate, so a null here
  // means "does not exist OR not yours" and the response is the same either
  // way. A 403 would confirm the map exists.
  if (!map) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  /*
   * ── The leak this closes ────────────────────────────────────────────────
   *
   * The visibility predicate decides WHETHER you may read this map. It says
   * nothing about WHICH NODES you may see, and this endpoint used to return
   * the stored map verbatim — so an invited member received the owner's
   * private nodes in full.
   *
   * §15 is explicit that a private node's subtree is "excluded from the share
   * payload server-side", and that rule applies to EVERY response reaching a
   * non-owner, not only to /s/<token>. Two endpoints returning the same map
   * with different filtering is precisely how one of them ends up wrong.
   *
   * So: the owner and staff get the editable draft; everyone else goes
   * through the same filter the share route uses.
   */
  if (map.canEdit || session.isStaff) {
    return NextResponse.json(map, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const payload = buildSharePayload(
      {
        id: map.id,
        title: map.title,
        family: map.family,
        visibility: map.visibility,
        nodeViewable: map.nodeViewable,
        rootId: map.rootId,
        nodes: map.nodes,
        version: map.version,
        updatedAt: map.updatedAt,
        ownerId: map.ownerId,
        ownerHandle: map.ownerHandle,
      },
      {
        userId: session.userId,
        isStaff: session.isStaff,
        role: getRole(session.userId, mapId),
        viaShareLink: false,
      },
    );

    // `canEdit: false` keeps the editor's shape so the client does not need a
    // second code path for "a map I can only read".
    return NextResponse.json(
      { ...payload, canEdit: false, dirty: [], metaDirty: false },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof NotVisibleError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw error;
  }
}

/**
 * PATCH — the autosave endpoint.
 *
 * The version check and the write happen in one transaction inside the
 * repository. Checking here and writing there would leave a window where two
 * saves both read the same version and the second silently overwrites the
 * first.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;

  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  const ctx = { userId: session.userId, isStaff: session.isStaff };

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = saveSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid map', issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }

  const { version, ...patch } = parsed.data;

  // Structural checks the schema cannot express. A map that fails these would
  // render as an empty or infinite canvas.
  if (patch.nodes) {
    const quota = checkNodeQuota(Object.keys(patch.nodes).length);
    if (quota) {
      return NextResponse.json(
        { error: quota.message, quota: quota.quota },
        { status: 403 },
      );
    }

    const existing = getMap(ctx, mapId);
    if (!existing)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const rootId = patch.rootId ?? existing.rootId;
    if (!patch.nodes[rootId]) {
      return NextResponse.json({ error: 'Map has no root node' }, { status: 400 });
    }
    for (const node of Object.values(patch.nodes)) {
      if (node.parent_id && !patch.nodes[node.parent_id]) {
        return NextResponse.json(
          { error: `Node ${node.id} points at a missing parent` },
          { status: 400 },
        );
      }

      /*
       * `type` is validated against the REGISTRY here, not against a fixed
       * enum on the zod schema above — see that field's own comment for why
       * a second, hand-kept list of type ids is exactly the bug that made
       * `product`, `task` and the rest of `packages.ts` uncreatable for a
       * full phase. `nodeTypeDef` already knows about every built-in type
       * AND every plugin-contributed one, so this check widens automatically
       * as the registry grows — nothing here has to be edited again.
       */
      if (!nodeTypeDef(node.type)) {
        return NextResponse.json(
          { error: `"${node.type}" is not a node type this app knows about` },
          { status: 400 },
        );
      }
    }
  }

  try {
    /*
     * The loop just above is what makes this cast honest: every node's
     * `type` has already been proven to resolve in the registry, which is
     * the only thing that actually distinguishes a `NodeType` from a bare
     * `string` at compile time. TypeScript cannot see that from inside a
     * `for` loop with early returns, so it is told here instead of the check
     * being duplicated in a form the compiler could follow on its own.
     */
    const saved = saveMap(
      ctx,
      mapId,
      version,
      patch as Parameters<typeof saveMap>[3],
    );

    /**
     * §15 collaboration: tell the other people on this map, and write the
     * activity entry.
     *
     * After the save, never before. The event is a nudge that sends every
     * listener to read the map; firing it before the write commits sends them
     * to read the version they already have, and the change appears to have
     * been lost.
     */
    const eventId = appendEvent(mapId, ctx.userId, 'node_changed', {
      version: saved.version,
    });
    publish(mapId, eventId);

    recordActivity(
      ctx,
      mapId,
      patch.title !== undefined ? 'map_renamed' : 'node_changed',
      {
        detail: patch.title !== undefined ? patch.title : '',
      },
    );

    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return NextResponse.json(
        { error: 'conflict', currentVersion: error.currentVersion },
        { status: 409 },
      );
    }
    if (error instanceof NotWritableError) {
      // Covers both "no such map" and "read-only for you". Same 404 for the
      // same reason as everywhere else.
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // Node ids are globally unique. A client that submits an id already
    // belonging to some other map has sent a bad request, not caused a server
    // fault — and the message must not say WHICH map holds it, since that
    // would confirm the existence of a map the caller may not be able to see.
    if (
      error instanceof Error &&
      /UNIQUE constraint failed: map_nodes\.id/.test(error.message)
    ) {
      return NextResponse.json(
        { error: 'A node id in this save is already in use' },
        { status: 409 },
      );
    }
    throw error;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;

  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  const removed = deleteMap(
    { userId: session.userId, isStaff: session.isStaff },
    mapId,
  );
  if (!removed) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return new NextResponse(null, { status: 204 });
}
