import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getNodeDetail, NodeNotFoundError } from '@/lib/nodes/detail';
import { getInterestStore } from '@/lib/interest/store';
import { clientEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Node detail API.
 *
 * The mode is decided HERE, on the server, and the payload is filtered to
 * match. A locked node returns its title and nothing else — see the note in
 * `getNodeDetail`. Sending the full record and hiding fields in the client
 * would ship private content to the browser, where anyone can read it in the
 * network tab.
 *
 * That is the P7 rule ("no private node data in any shared response body")
 * arriving early, because the alternative is retrofitting it onto a client
 * that has learned to expect complete objects.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ nodeId: string }> },
) {
  const { nodeId } = await params;
  const session = await getSession();

  try {
    const detail = getNodeDetail(
      nodeId,
      { userId: session?.userId ?? null, isStaff: session?.isStaff ?? false },
      clientEnv.NEXT_PUBLIC_SITE_URL,
    );

    // Social proof, but only where it is meaningful.
    if (detail.status === 'coming_soon') {
      detail.interestCount = await getInterestStore().countFor(nodeId);
    }

    return NextResponse.json(detail, {
      headers: {
        // Node content is public but changes; a short cache keeps repeat
        // taps instant without serving a stale title for long.
        'Cache-Control': 'private, max-age=30',
      },
    });
  } catch (error) {
    if (error instanceof NodeNotFoundError) {
      // 404 for "does not exist" and for "you may not know it exists" alike.
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw error;
  }
}
