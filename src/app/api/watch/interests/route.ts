import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT } from '@/lib/db/repo';
import { listInterests, setInterests } from '@/lib/watch/repo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/watch/interests — §13 step 2's chip grid, with live counts.
 *
 * Readable signed out. The picker is the first thing someone sees on this
 * screen, and requiring an account to look at a list of topics would be a
 * sign-in wall in front of the browsing feature. Only PERSISTING a selection
 * needs an account; before that it lives in the client.
 */
export async function GET() {
  const session = await getSession();
  const ctx = session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;

  return NextResponse.json({ interests: listInterests(ctx) });
}

const schema = z.object({
  tags: z.array(z.string().max(40)).max(40),
});

/** PUT /api/watch/interests — §13: "Selections persist to the profile". */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: 'Sign in to save your interests' },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid interests' }, { status: 400 });
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };

  try {
    setInterests(ctx, parsed.data.tags);
  } catch {
    // A tag outside the vocabulary trips the foreign key. That is a bad
    // request, not a server fault.
    return NextResponse.json({ error: 'Unknown interest' }, { status: 400 });
  }

  return NextResponse.json({ tags: parsed.data.tags });
}
