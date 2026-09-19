import { getSession } from '@/lib/auth/session';
import { MarketplaceBrowser } from '@/components/marketplace/MarketplaceBrowser';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Marketplace' };

/**
 * The marketplace. Public.
 *
 * Browsable signed out on purpose — a catalogue nobody can see before they
 * have an account is a catalogue that sells nothing. Ordering needs a session,
 * and the browser says so on each card rather than hiding the button.
 */
export default async function Page() {
  const session = await getSession();

  return (
    <div style={{ maxWidth: '64rem', margin: '0 auto', width: '100%' }}>
      <h1
        style={{
          fontSize: 'var(--text-display-m)',
          marginBottom: 'var(--space-4)',
        }}
      >
        Marketplace
      </h1>

      <MarketplaceBrowser signedIn={Boolean(session)} />
    </div>
  );
}
