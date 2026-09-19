import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT } from '@/lib/db/repo';
import { clientHash } from '@/lib/services/enquiries';
import {
  MAX_SUPPORT_MESSAGE,
  closeSupport,
  listSupport,
  submitSupport,
} from '@/lib/launch/support';

export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().max(200),
  topic: z.string().max(40),
  message: z.string().max(MAX_SUPPORT_MESSAGE),
  route: z.string().max(200).optional(),
});

/**
 * POST /api/support — the support inbox (§20 P14).
 *
 * Open to signed-out visitors: the person who cannot sign in is exactly the
 * person who most needs to reach support, and putting the form behind the
 * thing that is broken is a support process that only works for people who do
 * not need it.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the form' }, { status: 400 });
  }

  const session = await getSession();
  const ctx = session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;

  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() || '0.0.0.0';
  const userAgent = request.headers.get('user-agent') ?? '';

  const result = submitSupport(ctx, {
    ...parsed.data,
    userAgent,
    clientHash: clientHash(ip, userAgent),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: result.id });
}

/** GET — the queue. Staff only. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.isStaff) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const status = new URL(request.url).searchParams.get('status') ?? 'open';

  return NextResponse.json({
    messages: listSupport({ userId: session.userId, isStaff: true }, status),
  });
}

const closeSchema = z.object({ id: z.string().max(60) });

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session?.isStaff) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = closeSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const ok = closeSupport(
    { userId: session.userId, isStaff: true },
    parsed.data.id,
  );
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
