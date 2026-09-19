import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth/guard';
import { getMap } from '@/lib/db/repo';
import { capabilitiesOnMap } from '@/lib/permissions/resolve';
import { agentsOnMap } from '@/lib/agents/repo';
import { WorkflowBuilder } from '@/components/agents/WorkflowBuilder';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Workflows' };

export default async function Page({
  params,
}: {
  params: Promise<{ mapId: string }>;
}) {
  const { mapId } = await params;
  const session = await requireAuth(`/maps/${mapId}/workflows`);
  const ctx = { userId: session.userId, isStaff: session.isStaff };

  const map = getMap(ctx, mapId);
  if (!map) notFound();

  // Authoring a workflow is authoring automated writes — the same bar as
  // handing out a role, not merely editing a node.
  const canManage = capabilitiesOnMap(ctx, mapId).changeRoles;

  const agents = agentsOnMap(ctx, mapId).map((agent) => ({
    id: agent.id,
    name: agent.name,
  }));

  return (
    <div style={{ maxWidth: '52rem', margin: '0 auto', width: '100%' }}>
      <h1
        style={{
          fontSize: 'var(--text-display-m)',
          marginBottom: 'var(--space-6)',
        }}
      >
        Workflows on “{map.title}”
      </h1>

      <WorkflowBuilder mapId={mapId} agents={agents} canManage={canManage} />
    </div>
  );
}
