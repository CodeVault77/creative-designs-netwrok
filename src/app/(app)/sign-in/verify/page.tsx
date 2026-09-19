import { redirect } from 'next/navigation';
import { getPendingUserId, getSession } from '@/lib/auth/session';
import { MfaChallenge } from '@/components/account/MfaChallenge';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Enter your code' };

/**
 * The second-factor challenge screen.
 *
 * ── Reachable only by a pending session ─────────────────────────────────────
 *
 * `getPendingUserId` returns an id only when a session exists, is unexpired,
 * has NOT satisfied the second factor, and belongs to somebody with MFA
 * confirmed. Anyone else is sent away — a completed session to the app, and
 * anybody with no session at all back to sign-in.
 *
 * The id is resolved here purely to decide reachability. It is not passed to
 * the client and nothing about the account is rendered.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const pending = await getPendingUserId();

  if (!pending) {
    const session = await getSession();
    redirect(session ? '/app' : '/sign-in');
  }

  const { returnTo } = await searchParams;

  // Same-site paths only. An open redirect on a sign-in screen is a phishing
  // primitive: authenticate for real, then get bounced somewhere hostile.
  const destination = returnTo && /^\/[^/\\]/.test(returnTo) ? returnTo : '/app';

  return <MfaChallenge returnTo={destination} />;
}
