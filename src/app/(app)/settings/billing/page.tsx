import { requireAuth } from '@/lib/auth/guard';
import { BillingPanel } from '@/components/billing/BillingPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Plan and credits' };

/**
 * Plan, credits and invoices.
 *
 * A thin server component: the guard runs here, before anything renders, and
 * the panel fetches through `/api/billing` rather than reading the database in
 * the page. That is not indirection for its own sake — the same data has to
 * refresh after a checkout returns, and a server-rendered snapshot would show
 * the OLD plan until someone reloaded, which is precisely the moment a billing
 * page must be right.
 */
export default async function Page() {
  await requireAuth('/settings/billing');

  return (
    <div style={{ maxWidth: '48rem', margin: '0 auto', width: '100%' }}>
      <h1
        style={{
          fontSize: 'var(--text-display-m)',
          marginBottom: 'var(--space-6)',
        }}
      >
        Plan and credits
      </h1>

      <BillingPanel />
    </div>
  );
}
