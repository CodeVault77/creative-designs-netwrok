import { requireStaff } from '@/lib/auth/guard';
import { PlansPanel } from '@/components/admin/PlansPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Plans' };

/** Staff-only plan configuration. 404 for everyone else, as everywhere here. */
export default async function Page() {
  await requireStaff();

  return (
    <div style={{ maxWidth: '52rem', margin: '0 auto', width: '100%' }}>
      <h1
        style={{
          fontSize: 'var(--text-display-m)',
          marginBottom: 'var(--space-6)',
        }}
      >
        Plans
      </h1>

      <PlansPanel />
    </div>
  );
}
