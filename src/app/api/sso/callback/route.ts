import { NextResponse } from 'next/server';
import { completeSignIn } from '@/lib/enterprise/sso';
import { redirectUri } from '@/lib/enterprise/urls';
import { createSession, tagSessionConnection } from '@/lib/auth/session';
import { record } from '@/lib/enterprise/audit';

export const dynamic = 'force-dynamic';

/**
 * The OIDC callback.
 *
 * ── Everything that matters happens in `completeSignIn` ─────────────────────
 *
 * State consumption, the PKCE-bound code exchange and full ID-token
 * verification all live in `lib/enterprise/sso.ts`, where they can be tested
 * without a request. This route reads two query parameters and turns the
 * result into a redirect — deliberately, because a route handler is the
 * hardest place in the codebase to test and the worst place for a security
 * check to be sitting alone.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  /*
   * The provider's own error is honoured before anything else.
   *
   * `error=access_denied` is what a provider sends when the person pressed
   * Cancel, and treating that as a failed sign-in would show an alarming
   * message to somebody who simply changed their mind.
   */
  const providerError = params.get('error');
  if (providerError) {
    return NextResponse.redirect(
      new URL(
        providerError === 'access_denied' ? '/sign-in' : '/sign-in?sso=failed',
        request.url,
      ),
    );
  }

  const state = params.get('state') ?? '';
  const code = params.get('code') ?? '';

  if (!state || !code) {
    return NextResponse.redirect(new URL('/sign-in?sso=failed', request.url));
  }

  const result = await completeSignIn({ state, code, redirectUri: redirectUri() });

  if (!result.ok || !result.userId) {
    return NextResponse.redirect(new URL('/sign-in?sso=failed', request.url));
  }

  await createSession(result.userId);

  /*
   * An SSO session is marked as having satisfied the second factor.
   *
   * The identity provider is where MFA belongs in a federated setup — it is
   * what the organisation configured, audits and pays for. Challenging again
   * here would be a second, weaker factor layered on one the org already
   * enforces, and it would make SSO worse than not having it.
   */
  const { markSessionMfaSatisfied } = await import('@/lib/auth/session');
  await markSessionMfaSatisfied();

  if (result.connectionId) await tagSessionConnection(result.connectionId);

  const forwarded = request.headers.get('x-forwarded-for') ?? '';

  record({
    action: 'auth.signed_in',
    actorId: result.userId,
    metadata: { method: 'sso', provisioned: result.provisioned === true },
    clientIp: forwarded.split(',')[0]?.trim() || '0.0.0.0',
  });

  // `returnTo` was validated as a same-site path when the flow began. An open
  // redirect on a sign-in callback is a phishing primitive.
  return NextResponse.redirect(new URL(result.returnTo ?? '/app', request.url));
}
