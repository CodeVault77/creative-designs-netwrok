import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/auth/api';
import { listNotifications, markRead, unreadCount } from '@/lib/collab/repo';

export const dynamic = 'force-dynamic';

/** GET — screen 20. */
export async function GET() {
  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  const ctx = { userId: session.userId, isStaff: session.isStaff };

  return NextResponse.json({
    notifications: listNotifications(ctx),
    unread: unreadCount(ctx),
  });
}

const schema = z.object({
  ids: z.union([z.literal('all'), z.array(z.string().max(60)).max(100)]),
});

/** POST — mark read. */
export async function POST(request: Request) {
  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };
  markRead(ctx, parsed.data.ids);

  return NextResponse.json({ unread: unreadCount(ctx) });
}
