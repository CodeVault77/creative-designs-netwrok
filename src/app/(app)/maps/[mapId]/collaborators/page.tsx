import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth/guard';
import { getMap } from '@/lib/db/repo';
import { getRole } from '@/lib/db/sharing-repo';
import { buildRoute } from '@/lib/routes';
import { Collaborators } from '@/components/sharing';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Collaborators' };

/** Screen 12. */
export default async function Page({
  params,
}: {
  params: Promise<{ mapId: string }>;
}) {
  const { mapId } = await params;
  const session = await requireAuth(buildRoute.collaborators(mapId));

  const map = getMap({ userId: session.userId, isStaff: session.isStaff }, mapId);
  if (!map) notFound();

  return (
    <div style={{ maxWidth: '40rem', margin: '0 auto', width: '100%' }}>
      <h1
        style={{
          fontSize: 'var(--text-display-m)',
          marginBottom: 'var(--space-6)',
        }}
      >
        People on “{map.title}”
      </h1>
      <Collaborators
        mapId={mapId}
        currentUserId={session.userId}
        actorRole={getRole(session.userId, mapId)}
      />
    </div>
  );
}
