import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/auth/api';
import { saveItem } from '@/lib/watch/repo';

export const dynamic = 'force-dynamic';

const schema = z.object({
  itemId: z.string().max(60),
  saved: z.boolean(),
});

/** POST /api/watch/save — §13 step 4's Save action. */
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
  const ok = saveItem(ctx, parsed.data.itemId, parsed.data.saved);

  // 404 rather than 403 for an item that is not visible — a 403 confirms the
  // id exists, which is the same rule the rest of the app follows.
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ saved: parsed.data.saved });
}
