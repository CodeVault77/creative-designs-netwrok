import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { getSession, type Session } from './session';
import { buildRoute, type Access } from '@/lib/routes';

/**
 * Route guards.
 *
 * Guarding happens in the Server Component, before anything renders. A guard
 * that runs in a useEffect has already shipped the protected markup to the
 * browser and merely hidden it — which is not a guard, it is a curtain.
 */

/**
 * Requires a signed-in user. Redirects to sign-in carrying a return path, so
 * a deep link into a protected screen survives the round trip instead of
 * dumping the user on a generic home page.
 */
export async function requireAuth(returnTo: string): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(buildRoute.signIn(returnTo));
  return session;
}

/**
 * Requires staff.
 *
 * Renders 404, never 403 — §08 state matrix, screen 21: "Non-staff: 404,
 * never 403 (do not confirm the route exists)". A 403 tells an attacker they
 * have found the admin surface and only need credentials. A 404 tells them
 * nothing.
 *
 * Signed-out users get the same 404 rather than a sign-in redirect, for the
 * same reason: redirecting to sign-in would confirm the route is real.
 */
export async function requireStaff(): Promise<Session> {
  const session = await getSession();
  if (!session || !session.isStaff) notFound();
  return session;
}

/** Applies whichever guard a route's access level calls for. */
export async function applyGuard(
  access: Access,
  pathname: string,
): Promise<Session | null> {
  switch (access) {
    case 'staff':
      return requireStaff();
    case 'authed':
      return requireAuth(pathname);
    case 'public':
    default:
      return getSession();
  }
}
