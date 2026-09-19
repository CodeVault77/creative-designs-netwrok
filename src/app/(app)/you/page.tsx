import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { buildRoute, routes } from '@/lib/routes';

/**
 * `/you` is an alias, not a screen. It resolves to the signed-in user's own
 * profile so the You tab has a stable href that does not need to know the
 * handle before the session loads.
 */
export default async function Page() {
  const session = await getSession();
  if (!session) redirect(buildRoute.signIn(routes.you));
  redirect(buildRoute.profile(session.handle));
}
