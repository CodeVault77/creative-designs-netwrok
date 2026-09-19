import { isSignedIn } from '@/lib/auth/session';
import { FeedScreen } from '@/components/watch';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Page Watcher feed' };

/**
 * Screen 16 — the feed (§13 steps 4–7).
 *
 * Interests arrive in the query string so a signed-out visitor can browse a
 * selection they have not saved; a signed-in visitor with no parameter falls
 * back to their profile, which the API does.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tags?: string; saved?: string }>;
}) {
  const { tags, saved } = await searchParams;
  const initialTags = (tags ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  return (
    <FeedScreen
      initialTags={initialTags}
      initialSavedOnly={saved === '1'}
      signedIn={await isSignedIn()}
    />
  );
}
