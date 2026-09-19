import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth/guard';
import { getMap } from '@/lib/db/repo';
import { getRole, hasActiveShareToken } from '@/lib/db/sharing-repo';
import { capabilitiesFor } from '@/lib/sharing/roles';
import { buildRoute } from '@/lib/routes';
import { ShareSheet } from '@/components/sharing';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Share map' };

/** Screen 11. */
export default async function Page({
  params,
}: {
  params: Promise<{ mapId: string }>;
}) {
  const { mapId } = await params;
  const session = await requireAuth(buildRoute.shareMap(mapId));
  const ctx = { userId: session.userId, isStaff: session.isStaff };

  const map = getMap(ctx, mapId);
  if (!map) notFound();

  const role = getRole(session.userId, mapId);

  return (
    <div style={{ maxWidth: '34rem', margin: '0 auto', width: '100%' }}>
      <h1
        style={{
          fontSize: 'var(--text-display-m)',
          marginBottom: 'var(--space-6)',
        }}
      >
        Share “{map.title}”
      </h1>
      <ShareSheet
        mapId={mapId}
        mapTitle={map.title}
        initialVisibility={map.visibility}
        initialNodeViewable={map.nodeViewable}
        initialHasLink={hasActiveShareToken(ctx, mapId)}
        canChangePrivacy={capabilitiesFor(role).changePrivacy}
      />
    </div>
  );
}
