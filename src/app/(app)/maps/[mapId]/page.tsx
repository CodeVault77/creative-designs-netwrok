import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth/guard';
import { getMap } from '@/lib/db/repo';
import { getRole } from '@/lib/db/sharing-repo';
import { buildSharePayload, NotVisibleError } from '@/lib/sharing/payload';
import { buildRoute } from '@/lib/routes';
import { MapEditor } from '@/components/editor/MapEditor';
import type { MapDraft, DraftNode } from '@/lib/editor/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Map editor' };

/**
 * Screens 09 and 10.
 *
 * The map is loaded server-side so the editor mounts with real data; the
 * client then prefers a newer local draft if one exists (see `useEditor`).
 * That ordering matters — server-first would silently discard offline work.
 *
 * ── Filtering, and why it is here too ───────────────────────────────────────
 *
 * A member who can view but not edit reaches this page. Passing them the
 * stored map would put the owner's private nodes into the server-rendered
 * HTML, where they are readable with view-source regardless of what the
 * editor chooses to draw.
 *
 * §15 requires the exclusion to happen server-side on every path, so this page
 * runs the SAME filter as the share route. The owner gets the editable draft;
 * everyone else gets what they are allowed to see.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ mapId: string }>;
}) {
  const { mapId } = await params;
  const session = await requireAuth(buildRoute.mapEditor(mapId));
  const ctx = { userId: session.userId, isStaff: session.isStaff };

  const map = getMap(ctx, mapId);

  // Null means "no such map OR not visible to you". Both render 404 — a 403
  // would confirm it exists.
  if (!map) notFound();

  if (map.canEdit || session.isStaff) {
    const initial: MapDraft = {
      id: map.id,
      title: map.title,
      family: map.family,
      visibility: map.visibility,
      rootId: map.rootId,
      nodes: map.nodes,
      version: map.version,
      updatedAt: map.updatedAt,
      dirty: [],
      metaDirty: false,
    };

    return (
      <MapEditor
        initial={initial}
        readOnly={!map.canEdit}
        selfId={session.userId}
        // §15: Commenter and above may post. An owner or editor always can.
        canChat
      />
    );
  }

  let payload;
  try {
    payload = buildSharePayload(
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
  } catch (error) {
    if (error instanceof NotVisibleError) notFound();
    throw error;
  }

  // Back into the editor's shape, carrying only the fields that survived the
  // filter. What is missing here is missing from the HTML too.
  const nodes: Record<string, DraftNode> = {};
  for (const node of Object.values(payload.nodes)) {
    nodes[node.id] = {
      id: node.id,
      map_id: payload.id,
      parent_id: node.parent_id,
      slot: node.slot,
      title: node.title,
      family: node.family,
      type: node.type,
      status: node.status,
      visibility: 'inherit',
      weight: node.weight,
      ...(node.description ? { description: node.description } : {}),
      ...(node.href ? { href: node.href } : {}),
      ...(node.icon ? { icon: node.icon } : {}),
      ...(node.freeX !== undefined ? { freeX: node.freeX } : {}),
      ...(node.freeY !== undefined ? { freeY: node.freeY } : {}),
    };
  }

  const initial: MapDraft = {
    id: payload.id,
    title: payload.title,
    family: payload.family,
    visibility: payload.visibility,
    rootId: payload.rootId,
    nodes,
    version: payload.version,
    updatedAt: payload.updatedAt,
    dirty: [],
    metaDirty: false,
  };

  /**
   * A viewer on a shared map. They get the thread read-only (§15: a Viewer may
   * read but not post) and, being signed in, still appear in presence — which
   * is the honest thing to show the owner.
   */
  return (
    <MapEditor initial={initial} readOnly selfId={session.userId} canChat={false} />
  );
}
