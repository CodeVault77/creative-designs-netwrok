import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT } from '@/lib/db/repo';
import { decideApproval, pendingApprovals } from '@/lib/agents/workflows';

export const dynamic = 'force-dynamic';

/**
 * The approval queue.
 *
 * A workflow parked on an approval does nothing until someone answers here.
 * There is deliberately no expiry and no auto-approve: a gate that opens on a
 * timer is not a gate, and the run waiting forever is the correct behaviour
 * when nobody decides.
 */

const decideSchema = z.object({
  approvalId: z.string().max(60),
  approved: z.boolean(),
});

export async function GET(request: Request) {
  const session = await getSession();
  const ctx = session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;

  const mapId = new URL(request.url).searchParams.get('mapId');
  if (!mapId) {
    return NextResponse.json({ error: 'Which map?' }, { status: 400 });
  }

  return NextResponse.json({ approvals: pendingApprovals(ctx, mapId) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = decideSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the form' }, { status: 400 });
  }

  const result = decideApproval(
    { userId: session.userId, isStaff: session.isStaff },
    parsed.data.approvalId,
    parsed.data.approved,
  );

  if (!result.ok) {
    /*
     * 409, not 404.
     *
     * The common failure is a race — someone else decided first — and telling
     * the second person "no such approval" would send them looking for a bug
     * rather than refreshing the list.
     */
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
