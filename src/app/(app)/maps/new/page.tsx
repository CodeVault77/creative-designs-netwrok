import { requireAuth } from '@/lib/auth/guard';
import { routes } from '@/lib/routes';
import { NewMapForm } from '@/components/editor/NewMapForm';

export const metadata = { title: 'New map' };

/**
 * Screen 08.
 *
 * A full page rather than a modal. §08 calls it a modal, but a modal that is
 * also a deep-linkable route has to be both, and the name-plus-template
 * choice is substantial enough to deserve the room on a phone. The route is
 * what matters — someone can bookmark "start a new map".
 */
export default async function Page() {
  await requireAuth(routes.newMap);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        padding: 'var(--space-6) 0',
      }}
    >
      <NewMapForm />
    </div>
  );
}
