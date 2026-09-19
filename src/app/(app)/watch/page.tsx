import { isSignedIn } from '@/lib/auth/session';
import { WatchScreen } from '@/components/watch';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Page Watcher' };

/** Screen 15 — the interest picker (§13 steps 1–3). */
export default async function Page() {
  return <WatchScreen signedIn={await isSignedIn()} />;
}
