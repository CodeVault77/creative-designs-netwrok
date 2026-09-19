import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getMapUnscoped } from '@/lib/db/repo';
import { getRole, mapIdForShareToken } from '@/lib/db/sharing-repo';
import { buildSharePayload, NotVisibleError } from '@/lib/sharing/payload';
import { SharedMapScreen } from '@/components/sharing/SharedMapScreen';

export const dynamic = 'force-dynamic';

/**
 * A map opened through a share link.
 *
 * Outside the `(app)` route group on purpose: someone arriving from a link
 * they were sent is not navigating the product, and a tab bar offering My
 * Maps to a stranger is noise. They get the map, whose it is, and a way in.
 *
 * Server-rendered through the SAME filter as the API. Two paths to a payload
 * would be two chances to differ, and the one that differs is the one that
 * leaks.
 */
export const metadata = {
  // §15: link-viewable maps are "not indexed, not searchable".
  robots: { index: false, follow: false },
  title: 'Shared map',
};

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const mapId = mapIdForShareToken(token);
  if (!mapId) notFound();

  const map = getMapUnscoped(mapId);
  if (!map) notFound();

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

    return <SharedMapScreen payload={payload} signedIn={Boolean(session)} />;
  } catch (error) {
    if (error instanceof NotVisibleError) notFound();
    throw error;
  }
}
