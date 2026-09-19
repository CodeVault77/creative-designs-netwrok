import { requireAuth } from '@/lib/auth/guard';
import { DeveloperPanel } from '@/components/developer/DeveloperPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Developer' };

/**
 * API keys and webhooks.
 *
 * Behind the ordinary auth guard, not a staff one: a public API is for
 * everybody who uses the product, and gating it on staff would make the
 * ecosystem an internal tool.
 */
export default async function Page() {
  await requireAuth('/settings/developer');

  return (
    <div style={{ maxWidth: '52rem', margin: '0 auto', width: '100%' }}>
      <h1
        style={{
          fontSize: 'var(--text-display-m)',
          marginBottom: 'var(--space-4)',
        }}
      >
        Developer
      </h1>

      <DeveloperPanel />
    </div>
  );
}
