import 'server-only';
import { NextResponse } from 'next/server';
import { getSession, type Session } from './session';

/**
 * The API equivalent of the page guards in `guard.ts`.
 *
 * Pages redirect; an API must not — a fetch that follows a redirect to an HTML
 * sign-in page and tries to parse it as JSON produces a confusing error a long
 * way from the cause. So these return a response the caller forwards.
 *
 * Usage keeps the guard impossible to skip by accident:
 *
 *   const session = await requireAuthApi();
 *   if (session instanceof NextResponse) return session;
 *   // session is a Session from here on, and TypeScript knows it
 */
export async function requireAuthApi(): Promise<Session | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  return session;
}

/**
 * Ownership check.
 *
 * Returns 404, not 403, for a map the viewer does not own — the same reasoning
 * as the staff routes (§08 screen 21). A 403 confirms the map exists, which
 * turns map ids into something worth enumerating.
 */
export function requireOwner(
  session: Session,
  ownerId: string,
): NextResponse | null {
  if (session.userId !== ownerId && !session.isStaff) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return null;
}
