import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth/guard';
import { getMap } from '@/lib/db/repo';
import { capabilitiesOnMap } from '@/lib/permissions/resolve';
import { AgentManager } from '@/components/agents/AgentManager';
import { ApprovalQueue } from '@/components/agents/ApprovalQueue';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Agents' };

/**
 * Agents and the approval queue, on one screen.
 *
 * They belong together: the queue is where an agent's work waits for a person,
 * and someone checking on an agent is the same person who needs to answer for
 * it. Splitting them across two routes would mean noticing a pending approval
 * required knowing to go and look.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ mapId: string }>;
}) {
  const { mapId } = await params;
  const session = await requireAuth(`/maps/${mapId}/agents`);
  const ctx = { userId: session.userId, isStaff: session.isStaff };

  const map = getMap(ctx, mapId);
  if (!map) notFound();

  // Authoring agents is the same bar as handing out roles, not editing.
  const canManage = capabilitiesOnMap(ctx, mapId).changeRoles;

  /*
   * Nodes come from getMap, not from the database handle.
   *
   * chokepoint.test.ts forbids anything under app/ from touching the raw
   * handle, and it is right to: a page that queries directly has to re-derive
   * visibility itself, and getting that subtly wrong is how a private node
   * ends up in a dropdown. getMap has already applied it.
   */
  const nodes = Object.values(map.nodes)
    .sort((a, b) => a.slot - b.slot)
    .slice(0, 200)
    .map((node) => ({ id: node.id, title: node.title }));

  return (
    <div style={{ maxWidth: '44rem', margin: '0 auto', width: '100%' }}>
      <h1
        style={{
          fontSize: 'var(--text-display-m)',
          marginBottom: 'var(--space-6)',
        }}
      >
        Agents on “{map.title}”
      </h1>

      <AgentManager mapId={mapId} nodes={nodes} canManage={canManage} />

      <h2
        style={{
          fontSize: 'var(--text-title)',
          margin: 'var(--space-12) 0 var(--space-4)',
        }}
      >
        Waiting for you
      </h2>

      <ApprovalQueue mapId={mapId} />
    </div>
  );
}
