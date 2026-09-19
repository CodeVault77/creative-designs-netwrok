import { clientEnv, serverEnv } from '@/lib/env';

/**
 * The absolute URLs the SSO flow depends on.
 *
 * ── Why the redirect URI is computed in one place ───────────────────────────
 *
 * An OIDC provider matches the `redirect_uri` we send against a list the
 * administrator registered, exactly, character for character. A trailing
 * slash, http versus https, or `www.` present in one and absent in the other
 * are each a failed sign-in with an unhelpful error on the provider's page.
 *
 * So it is computed once, from configuration, and the settings screen SHOWS
 * the result — because the value an admin pastes into Okta must be the value
 * this code will send, and the only way to guarantee that is to display it
 * rather than document it.
 *
 * It must never be derived from a request header. `Host` is attacker-supplied,
 * and an authorisation code delivered to a host of the attacker's choosing is
 * an account takeover.
 */

function base(): string {
  const configured =
    serverEnv.ENTERPRISE_BASE_URL ?? clientEnv.NEXT_PUBLIC_SITE_URL;
  return configured.replace(/\/$/, '');
}

/** Where the provider sends the browser back. Registered with the provider. */
export function redirectUri(): string {
  return `${base()}/api/sso/callback`;
}

/** Where the browser goes to begin. */
export function startUrl(connectionId: string, returnTo?: string): string {
  const params = new URLSearchParams({ connection: connectionId });
  if (returnTo) params.set('returnTo', returnTo);

  return `${base()}/api/sso/start?${params.toString()}`;
}

export function absolute(path: string): string {
  return `${base()}${path.startsWith('/') ? path : `/${path}`}`;
}
