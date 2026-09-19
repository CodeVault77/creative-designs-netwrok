import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth/guard';
import { KillSwitchPanel } from '@/components/agents/KillSwitchPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Agent controls' };

/**
 * Staff-only agent controls.
 *
 * 404 rather than 403 for a non-staff visitor, like every other staff surface
 * here: a 403 confirms the page exists, which is a small thing to give away
 * about an admin route.
 */
export default async function Page() {
  const session = await requireAuth('/admin/agents');
  if (!session.isStaff) notFound();

  return (
    <div style={{ maxWidth: '40rem', margin: '0 auto', width: '100%' }}>
      <h1
        style={{
          fontSize: 'var(--text-display-m)',
          marginBottom: 'var(--space-6)',
        }}
      >
        Agent controls
      </h1>

      <KillSwitchPanel />
    </div>
  );
}
