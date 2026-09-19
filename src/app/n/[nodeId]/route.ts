import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { communityMap } from '@/lib/map/seed';
import { modeFor } from '@/lib/nodes/detail';
import { buildRoute } from '@/lib/routes';

export const dynamic = 'force-dynamic';

/**
 * `/n/<id>` — the canonical public share URL for a node (§10).
 *
 * A Route Handler rather than a page because it renders nothing: it resolves
 * the node and redirects. Keeping the public URL short and opaque means the
 * internal structure can change without breaking links already sitting in
 * messages and bookmarks, and node-level links are the product's main growth
 * mechanism, so they must keep working indefinitely.
 *
 * ── Resolution rules ────────────────────────────────────────────────────────
 *
 *   Coming Soon      → /soon/<id>, the shareable page, not the map
 *   Community node   → /map?node=<id>
 *   Private, no access → 404, NOT 403
 *   Unknown          → 404
 *
 * The private case returns the SAME 404 as an unknown id, for the same reason
 * the moderation route does (§08 screen 21): a 403 confirms the node exists,
 * which turns a shared link into an existence oracle someone can enumerate.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ nodeId: string }> },
) {
  const { nodeId } = await params;

  const graph = communityMap();
  const node = graph.nodes.get(nodeId);

  if (!node) notFound();

  const session = await getSession();
  const mode = modeFor(node, {
    userId: session?.userId ?? null,
    isStaff: session?.isStaff ?? false,
  });

  if (mode === 'locked') notFound();

  if (mode === 'soon') {
    redirect(buildRoute.comingSoon(node.id));
  }

  // P6 chooses between the Community Map and a user map here, once nodes can
  // belong to something other than `community`.
  redirect(buildRoute.mapNode(node.id));
}
