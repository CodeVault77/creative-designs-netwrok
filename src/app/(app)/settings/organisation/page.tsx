import { requireAuth } from '@/lib/auth/guard';
import { OrgAdminPanel } from '@/components/enterprise/OrgAdminPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Organisation' };

/**
 * Organisation policy, SSO, branding and the audit log.
 *
 * Guarded on being signed in rather than on being an admin: the panel resolves
 * the caller's role per organisation and shows what they may see. Guarding
 * here would need the org id, which is chosen on the screen itself.
 */
export default async function Page() {
  await requireAuth('/settings/organisation');

  return (
    <div style={{ maxWidth: '52rem', margin: '0 auto', width: '100%' }}>
      <h1
        style={{
          fontSize: 'var(--text-display-m)',
          marginBottom: 'var(--space-4)',
        }}
      >
        Organisation
      </h1>

      <OrgAdminPanel />
    </div>
  );
}
