import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/auth/api';
import { CAN, acquireLock, releaseLock, roleOn } from '@/lib/collab/repo';

export const dynamic = 'force-dynamic';

const schema = z.object({ nodeId: z.string().max(60) });

/**
 * POST /api/maps/[mapId]/lock — take or renew the soft lock (§15).
 *
 * Acquire and renew are the SAME call. Separating them would make the client
 * track whether it already holds the lock, and get that wrong exactly when the
 * answer matters — after a reconnect.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;
  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  const ctx = { userId: session.userId, isStaff: session.isStaff };

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

  /**
   * Authorisation BEFORE contention.
   *
   * `acquireLock` already refuses a caller who cannot edit, so nothing was
   * ever locked or leaked — but it refused by returning the same
   * `{ ok: false }` a legitimately contended lock returns, under HTTP 200.
   * Found by the P13 security pass: every other endpoint answers a stranger
   * with 404, and an endpoint that answers 200 instead is the one that starts
   * leaking the day someone adds a field to that response.
   */
  const role = roleOn(ctx, mapId);
  if (!role || !CAN.edit(role)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { ok, holder } = acquireLock(ctx, mapId, parsed.data.nodeId);

  /**
   * 200 with `ok: false`, not 409.
   *
   * A contended lock is a normal outcome the UI renders as "Sam is editing
   * this" — §15's exact words — and it needs the holder's name to do it. An
   * error status would push this through the client's failure path, where
   * that name has nowhere to go.
   */
  return NextResponse.json({
    ok,
    holder: holder ? { userId: holder.userId, name: holder.name } : null,
    message: ok || !holder ? null : `${holder.name} is editing this.`,
  });
}

/** DELETE — release. Best-effort: the lease expires on its own anyway. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;
  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  const nodeId = new URL(request.url).searchParams.get('nodeId') ?? '';
  releaseLock({ userId: session.userId, isStaff: session.isStaff }, mapId, nodeId);

  return NextResponse.json({ released: true });
}
