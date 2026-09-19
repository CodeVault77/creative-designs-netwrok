import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { acceptInvite } from '@/lib/db/sharing-repo';
import { buildRoute } from '@/lib/routes';
import { InviteResult } from '@/components/sharing/InviteResult';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invitation' };

/**
 * Accepting an invite.
 *
 * A signed-out visitor is sent to sign in and BACK here, so the invite is not
 * lost. Requiring an account first and dropping the token is the classic way
 * to make an invitation fail silently — the person signs up, lands on an empty
 * My Maps, and has no idea what happened.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getSession();

  if (!session) {
    redirect(buildRoute.signIn(`/invite/${encodeURIComponent(token)}`));
  }

  const result = acceptInvite(token, session.userId);

  if (result.ok) {
    redirect(buildRoute.mapEditor(result.mapId));
  }

  return <InviteResult reason={result.reason} />;
}
