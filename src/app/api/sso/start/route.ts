import { NextResponse } from 'next/server';
import { beginSignIn } from '@/lib/enterprise/sso';
import { redirectUri } from '@/lib/enterprise/urls';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sso/start?connection=…&returnTo=… — begin an SSO sign-in.
 *
 * A GET that redirects, because it is reached by a link on the sign-in screen
 * and by a bookmark an organisation hands its staff. It is safe as a GET: it
 * creates a short-lived state row and nothing else, and the row is worthless
 * to anyone who did not also complete the flow in the same browser.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const connectionId = params.get('connection') ?? '';

  const result = beginSignIn(
    connectionId,
    redirectUri(),
    params.get('returnTo') ?? '/app',
  );

  if (!result.ok || !result.url) {
    // Back to sign-in with a flag rather than a bare error page: whoever hit
    // this was trying to sign in, and that is where they should end up.
    return NextResponse.redirect(new URL('/sign-in?sso=unavailable', request.url));
  }

  return NextResponse.redirect(result.url);
}
