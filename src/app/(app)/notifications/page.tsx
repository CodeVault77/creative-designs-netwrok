import { NotificationsScreen } from '@/components/collab';
import { requireAuth } from '@/lib/auth/guard';
import { routes } from '@/lib/routes';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications' };

/** Screen 19/20 — what happened on maps you share (§15). */
export default async function Page() {
  await requireAuth(routes.notifications);
  return <NotificationsScreen />;
}
