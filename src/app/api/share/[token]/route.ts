import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getMapUnscoped } from '@/lib/db/repo';
import { getRole, mapIdForShareToken } from '@/lib/db/sharing-repo';
import { buildSharePayload, NotVisibleError } from '@/lib/sharing/payload';

export const dynamic = 'force-dynamic';

/**
 * The shared-map endpoint.
 *
 * This is the response body §20's acceptance criterion is about: "no private
 * node data in any shared response body". Everything it returns comes from
 * `buildSharePayload`, which builds a new object field by field — so a field
 * added to the stored node later is omitted by default rather than leaked by
 * default.
 *
 * `getMapUnscoped` is used deliberately and is safe HERE and only here,
 * because the token is the credential and the filter immediately below makes
 * the visibility decision.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const mapId = mapIdForShareToken(token);
  // A revoked or unknown token is a 404, never a 403. A 403 would confirm the
  // link was real, which turns a leaked-and-revoked link into information.
  if (!mapId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const map = getMapUnscoped(mapId);
  if (!map) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const session = await getSession();

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
        userId: session?.userId ?? null,
        isStaff: session?.isStaff ?? false,
        role: getRole(session?.userId ?? null, mapId),
        viaShareLink: true,
      },
    );

    return NextResponse.json(payload, {
      headers: {
        // §15: a link-viewable map is "not indexed, not searchable".
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof NotVisibleError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw error;
  }
}
