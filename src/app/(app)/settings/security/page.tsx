import { requireAuth } from '@/lib/auth/guard';
import { SecurityPanel } from '@/components/security/SecurityPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Security' };

/** Two-factor authentication and linked identity providers. */
export default async function Page() {
  await requireAuth('/settings/security');

  return (
    <div style={{ maxWidth: '44rem', margin: '0 auto', width: '100%' }}>
      <h1
        style={{
          fontSize: 'var(--text-display-m)',
          marginBottom: 'var(--space-4)',
        }}
      >
        Security
      </h1>

      <SecurityPanel />
    </div>
  );
}
