import Link from 'next/link';
import { ScreenScaffold } from '@/components/shell/ScreenScaffold';
import { requireAuth } from '@/lib/auth/guard';
import { routes } from '@/lib/routes';

export const metadata = { title: 'Settings' };

export default async function Page() {
  await requireAuth(routes.settings);

  return (
    <>
      {/*
        Screen 20 itself is still scaffolded, but billing is built and a page
        nothing links to may as well not exist. This is a link, not the start
        of a settings design — the phase that builds screen 20 replaces it.
      */}
      <nav
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-4)',
          justifyContent: 'center',
          margin: 'var(--space-6) 0 0',
        }}
      >
        <Link href="/settings/security">Security</Link>
        <Link href="/settings/organisation">Organisation</Link>
        <Link href="/settings/billing">Plan and credits</Link>
        <Link href="/settings/developer">Developer</Link>
        <Link href="/settings/plugins">Plugins</Link>
        <Link href="/marketplace">Marketplace</Link>
      </nav>

      <ScreenScaffold screen="20" />
    </>
  );
}
