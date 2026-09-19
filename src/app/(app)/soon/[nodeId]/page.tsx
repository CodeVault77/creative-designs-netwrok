import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getNodeDetail, NodeNotFoundError } from '@/lib/nodes/detail';
import { getInterestStore } from '@/lib/interest/store';
import { clientEnv } from '@/lib/env';
import { ComingSoonScreen } from '@/components/node/ComingSoonScreen';

export const dynamic = 'force-dynamic';

/**
 * Screen 22 — Coming Soon, as a full page.
 *
 * It has its own route as well as being a sheet state because "notify me"
 * links get shared: someone should be able to send a friend the Commerce
 * node's page directly (§10 — every important node is shareable). The sheet
 * and this page render the same component.
 *
 * Server-rendered so the target window and interest count are in the HTML.
 * A shared link that arrives as an empty shell and then fills in reads as
 * broken, and this is a link people will send to each other.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ nodeId: string }>;
}) {
  const { nodeId } = await params;
  try {
    const detail = getNodeDetail(
      nodeId,
      { userId: null, isStaff: false },
      clientEnv.NEXT_PUBLIC_SITE_URL,
    );
    return {
      title: `${detail.title} — coming soon`,
      description: detail.description,
    };
  } catch {
    return { title: 'Coming soon' };
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ nodeId: string }>;
}) {
  const { nodeId } = await params;
  const session = await getSession();

  let detail;
  try {
    detail = getNodeDetail(
      nodeId,
      { userId: session?.userId ?? null, isStaff: session?.isStaff ?? false },
      clientEnv.NEXT_PUBLIC_SITE_URL,
    );
  } catch (error) {
    if (error instanceof NodeNotFoundError) notFound();
    throw error;
  }

  // A live node has no Coming Soon page. Sending someone here for a node that
  // shipped would be actively misleading, so it 404s rather than rendering an
  // out-of-date promise.
  if (detail.status !== 'coming_soon') notFound();

  detail.interestCount = await getInterestStore().countFor(nodeId);

  return <ComingSoonScreen detail={detail} />;
}
