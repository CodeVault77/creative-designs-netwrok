import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/auth/api';
import { getMap } from '@/lib/db/repo';
import {
  createShareToken,
  hasActiveShareToken,
  revokeShareTokens,
  setVisibility,
} from '@/lib/db/sharing-repo';
import { shareUrlFor } from '@/lib/email/outbox';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  visibility: z.enum(['private', 'link', 'public']),
  nodeViewable: z.boolean(),
});

/** GET — current share state, for screen 11. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;

  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  const ctx = { userId: session.userId, isStaff: session.isStaff };
  const map = getMap(ctx, mapId);
  if (!map) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    visibility: map.visibility,
    nodeViewable: map.nodeViewable,
    hasLink: hasActiveShareToken(ctx, mapId),
  });
}

/**
 * PATCH — change visibility and node-viewable.
 *
 * Both in one call because they are one decision: "who can see this, and how
 * much". Two endpoints would allow a half-applied state where a map is public
 * for a moment with the wrong detail setting.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;

  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };
  const ok = setVisibility(
    ctx,
    mapId,
    parsed.data.visibility,
    parsed.data.nodeViewable,
  );

  // 404 rather than 403: the repository refused, and we do not confirm whether
  // that was because the map is missing or because this role cannot do it.
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}

/** POST — mint a link, revoking any previous one. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;

  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  const link = createShareToken(
    { userId: session.userId, isStaff: session.isStaff },
    mapId,
  );
  if (!link) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // The token is returned exactly ONCE, here. It is stored hashed, so it
  // cannot be shown again later — the same bargain as a password.
  return NextResponse.json({ url: shareUrlFor(link.token) });
}

/** DELETE — revoke the link. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;

  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  revokeShareTokens({ userId: session.userId, isStaff: session.isStaff }, mapId);
  return NextResponse.json({ ok: true });
}
