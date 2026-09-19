import { CommunityMapScreen } from '@/components/map/CommunityMapScreen';
import { getSession } from '@/lib/auth/session';

export const metadata = { title: 'Community Map' };

/**
 * Screen 02 — the Community Map.
 *
 * The `?node=` param arrives here so a deep link lands with that node already
 * selected. It is a query param and not a route segment precisely so the map
 * is not remounted when selection changes (docs/07-navigation.md).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ node?: string }>;
}) {
  const { node } = await searchParams;

  // The map itself is public — the session is read only to decide which
  // controls are offered, never to gate the map.
  const session = await getSession();

  return (
    <CommunityMapScreen
      initialSelectedId={node ?? null}
      signedIn={Boolean(session)}
    />
  );
}
