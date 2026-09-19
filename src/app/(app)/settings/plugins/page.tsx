import { requireAuth } from '@/lib/auth/guard';
import { SCOPES } from '@/lib/api/scopes';
import { PluginManager } from '@/components/plugins/PluginManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Plugins' };

/**
 * Plugins the signed-in person has installed, and what they could install.
 *
 * The scope catalogue is passed down from the server rather than fetched or
 * copied into the client: the consent screen must show exactly the wording the
 * server enforces, and two hand-kept copies of a permission list diverge.
 */
export default async function Page() {
  await requireAuth('/settings/plugins');

  return (
    <div style={{ maxWidth: '56rem', margin: '0 auto', width: '100%' }}>
      <h1
        style={{
          fontSize: 'var(--text-display-m)',
          marginBottom: 'var(--space-4)',
        }}
      >
        Plugins
      </h1>

      <PluginManager scopeCatalogue={SCOPES} />
    </div>
  );
}
