import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/auth/api';
import {
  NotWritableError,
  VersionConflictError,
  countNodes,
  getMap,
  listOwnedMaps,
  saveMap,
} from '@/lib/db/repo';
import { checkNodeQuota } from '@/lib/quotas';
import { newNodeId } from '@/lib/editor/draft';
import { getItem } from '@/lib/watch/repo';
import type { DraftNode } from '@/lib/editor/types';

export const dynamic = 'force-dynamic';

/**
 * §13 step 6: "Add to map opens a compact picker: which map, which parent
 * node."
 *
 * This route is the whole reason Page Watcher is not a generic feed. §13 is
 * explicit that "the design risk is that it becomes a generic feed and stops
 * being CDN. The fix is that every card can become a node."
 */

/** GET — the picker's options: maps this user can write to. */
export async function GET() {
  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  const ctx = { userId: session.userId, isStaff: session.isStaff };

  // Owned maps only. A map shared with you as a viewer is not somewhere you
  // can add a node, and offering it in the picker would produce a confusing
  // failure at the last step instead of an honest absence at the first.
  return NextResponse.json({
    maps: listOwnedMaps(ctx).map((map) => ({
      id: map.id,
      title: map.title,
      family: map.family,
      nodeCount: map.nodeCount,
    })),
  });
}

const schema = z.object({
  itemId: z.string().max(60),
  mapId: z.string().max(60),
  /** Omitted means the map's root. */
  parentId: z.string().max(60).optional(),
});

export async function POST(request: Request) {
  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  const ctx = { userId: session.userId, isStaff: session.isStaff };

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const item = getItem(ctx, parsed.data.itemId);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // getMap applies the visibility predicate; a map that is not ours comes back
  // null and is reported as missing rather than forbidden.
  const map = getMap(ctx, parsed.data.mapId);
  if (!map || !map.canEdit) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const parentId = parsed.data.parentId ?? map.rootId;
  const parent = map.nodes[parentId];
  if (!parent) {
    return NextResponse.json({ error: 'No such parent node' }, { status: 400 });
  }

  const quota = checkNodeQuota(countNodes(map.id) + 1);
  if (quota) return NextResponse.json({ error: quota.message }, { status: 403 });

  /**
   * The next free angular slot under this parent.
   *
   * ADR-0002: a slot is assigned once and never moves. Taking max + 1 rather
   * than the count means deleting a sibling does not hand its position to the
   * next node added, which would visibly shuffle a map the user had arranged.
   */
  const siblings = Object.values(map.nodes).filter((n) => n.parent_id === parentId);
  const slot = siblings.reduce((max, node) => Math.max(max, node.slot), -1) + 1;

  const id = newNodeId();
  const node: DraftNode = {
    id,
    map_id: map.id,
    parent_id: parentId,
    slot,
    title: item.title.slice(0, 60),
    description: item.excerpt.slice(0, 240),
    // The item's own family, not the map's. The card was that colour in the
    // feed, and a node that changes colour on arrival breaks the link between
    // what was chosen and what appeared.
    family: item.family,
    type: 'link',
    status: 'active',
    visibility: 'inherit',
    weight: 0.5,
    href: item.href,
  };

  try {
    const result = saveMap(ctx, map.id, map.version, {
      nodes: { ...map.nodes, [id]: node },
    });

    return NextResponse.json({
      nodeId: id,
      mapId: map.id,
      mapTitle: map.title,
      version: result.version,
      // §13 step 6: 'a toast: Added to "Research" · View in map'.
      href: `/maps/${map.id}?focus=${id}`,
    });
  } catch (error) {
    if (error instanceof VersionConflictError) {
      // Someone else changed the map between our read and our write. Retrying
      // is the caller's call: silently re-reading and re-writing here would
      // overwrite whatever they did.
      return NextResponse.json(
        { error: 'That map changed while you were adding. Try again.' },
        { status: 409 },
      );
    }
    if (error instanceof NotWritableError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw error;
  }
}
