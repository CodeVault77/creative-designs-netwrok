import { ModerationScreen } from '@/components/moderation';
import { requireStaff } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Moderation' };

/**
 * Screen 21 — the moderation queue (§15).
 *
 * Staff only. requireStaff() renders 404 rather than 403 for everyone else —
 * a 403 would confirm the route exists, which is the first thing worth knowing
 * if you intend to attack it.
 */
export default async function Page() {
  await requireStaff();
  return <ModerationScreen />;
}
