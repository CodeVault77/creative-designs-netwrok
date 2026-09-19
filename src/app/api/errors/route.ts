import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT } from '@/lib/db/repo';
import {
  MAX_STACK,
  listErrors,
  recordError,
  resolveError,
} from '@/lib/launch/errors';

export const dynamic = 'force-dynamic';

const schema = z.object({
  message: z.string().max(500),
  stack: z.string().max(MAX_STACK).optional(),
  route: z.string().max(200).optional(),
  source: z.enum(['client', 'server']).optional(),
});

/**
 * POST /api/errors — error tracking (§20 P14).
 *
 * Public, because the errors worth knowing about happen to signed-out visitors
 * on the very first screen. Bounded and grouped by fingerprint, so a page
 * stuck in a render loop reporting the same error a thousand times a second
 * costs one row and a counter rather than a thousand rows.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 202 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 202 });
  }

  recordError({
    message: parsed.data.message,
    ...(parsed.data.stack !== undefined ? { stack: parsed.data.stack } : {}),
    ...(parsed.data.route !== undefined ? { route: parsed.data.route } : {}),
    source: 'client',
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}

/** GET — the error list. Staff only: a stack trace can carry a route or a value. */
export async function GET(request: Request) {
  const session = await getSession();
  const ctx = session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;

  if (!ctx.isStaff) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const includeResolved = new URL(request.url).searchParams.get('resolved') === '1';

  return NextResponse.json({ errors: listErrors(ctx, { includeResolved }) });
}

const resolveSchema = z.object({ fingerprint: z.string().max(64) });

/** PATCH — mark resolved. Recurrence reopens it automatically. */
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

  const parsed = resolveSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const ok = resolveError(
    { userId: session.userId, isStaff: true },
    parsed.data.fingerprint,
  );

  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
