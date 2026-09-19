import { requireStaff } from '@/lib/auth/guard';
import { PipelineBoard } from '@/components/admin/PipelineBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pipeline' };

/**
 * The professional-services pipeline. Staff only.
 *
 * The session's user id is passed down so "assign to me" needs no extra
 * lookup, and so the board can tell which deals are already the viewer's.
 */
export default async function Page() {
  const session = await requireStaff();

  return (
    <div style={{ maxWidth: '60rem', margin: '0 auto', width: '100%' }}>
      <h1
        style={{
          fontSize: 'var(--text-display-m)',
          marginBottom: 'var(--space-6)',
        }}
      >
        Pipeline
      </h1>

      <PipelineBoard staffId={session.userId} />
    </div>
  );
}
