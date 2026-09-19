import { requireAuth } from '@/lib/auth/guard';
import { listOwnedMaps, listSharedMaps } from '@/lib/db/repo';
import { routes } from '@/lib/routes';
import { MyMaps } from '@/components/account';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Maps' };

/** Screen 07. */
export default async function Page() {
  const session = await requireAuth(routes.maps);
  const ctx = { userId: session.userId, isStaff: session.isStaff };

  // Both queries go through the repository, so both carry the ownership
  // predicate. Neither can return someone else's map.
  return <MyMaps owned={listOwnedMaps(ctx)} shared={listSharedMaps(ctx)} />;
}
