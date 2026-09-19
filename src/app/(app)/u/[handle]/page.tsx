import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import {
  getUserByHandle,
  listOwnedMaps,
  listPublicMapsFor,
  listSharedMaps,
} from '@/lib/db/repo';
import { unreadCount } from '@/lib/collab/repo';
import { ProfileScreen } from '@/components/account';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const user = getUserByHandle(handle);
  return { title: user ? user.displayName : 'Profile' };
}

/**
 * Screen 18.
 *
 * Public: anyone can see a profile and its public maps. The owner sees the
 * same page plus the edit control — one screen, not two, so what a visitor
 * sees is never a guess.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const user = getUserByHandle(handle);
  if (!user) notFound();

  const session = await getSession();

  // Public maps only, whoever is looking. The owner's private maps live in My
  // Maps; surfacing them here would make "view as someone else" a thing the
  // owner has to reason about.
  const publicMaps = listPublicMapsFor(user.id).map((map) => ({
    id: map.id,
    title: map.title,
    family: map.family,
    visibility: map.visibility,
    nodeCount: map.nodeCount,
    updatedAt: map.updatedAt,
    relation: map.relation,
    ownerHandle: map.ownerHandle,
  }));

  /**
   * The account panel is the OWNER's, and it is computed only for them.
   *
   * Screen 18 in the design canvas is the signed-in "You" screen: counts,
   * account rows, settings. This route is also the PUBLIC profile, so those
   * belong behind the ownership check rather than beside it — a visitor must
   * not learn how many private maps someone has, let alone see links into
   * their settings.
   *
   * Every number is read from the database. None of them are seeded to match
   * the reference: a profile that overstates what you have made is a lie about
   * the one subject the reader can check.
   */
  const isOwner = session?.userId === user.id;

  const account = isOwner
    ? (() => {
        const ctx = { userId: user.id, isStaff: user.isStaff };
        const owned = listOwnedMaps(ctx);

        return {
          maps: owned.length,
          nodes: owned.reduce((total, map) => total + map.nodeCount, 0),
          shared: listSharedMaps(ctx).length,
          unread: unreadCount(ctx),
        };
      })()
    : null;

  return (
    <ProfileScreen
      {...(account ? { account } : {})}
      displayName={user.displayName}
      handle={user.handle}
      bio={user.bio}
      avatarUrl={user.avatarUrl}
      isOwner={isOwner}
      isStaff={user.isStaff}
      publicMaps={publicMaps}
    />
  );
}
