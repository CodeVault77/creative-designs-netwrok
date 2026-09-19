import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/auth/api';
import {
  createInvite,
  listMembers,
  listPendingInvites,
  removeMember,
  revokeInvite,
  setMemberRole,
} from '@/lib/db/sharing-repo';
import { getMap } from '@/lib/db/repo';
import { acceptUrlFor, inviteEmail, queueEmail } from '@/lib/email/outbox';
import { ASSIGNABLE_ROLES } from '@/lib/sharing/roles';

export const dynamic = 'force-dynamic';

const roleSchema = z.enum(['admin', 'editor', 'commenter', 'viewer']);

const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .email('That does not look like an email address')
    .max(320),
  role: roleSchema,
});

const patchSchema = z.object({
  userId: z.string().min(1).max(128),
  role: roleSchema,
});

/** GET — screen 12. */
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
    members: listMembers(ctx, mapId),
    // Empty for anyone who cannot invite — the repository decides, not the UI.
    invites: listPendingInvites(ctx, mapId),
    assignableRoles: ASSIGNABLE_ROLES,
  });
}

/** POST — invite someone. */
export async function POST(
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

  const parsed = inviteSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Check the form' },
      { status: 400 },
    );
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };
  const map = getMap(ctx, mapId);
  if (!map) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const invite = createInvite(ctx, mapId, parsed.data.email, parsed.data.role);
  if (!invite) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = acceptUrlFor(invite.token);
  const mail = inviteEmail(map.title, session.displayName, invite.role, url);
  queueEmail(invite.email, mail.subject, mail.body);

  // The link comes back so the inviter can send it themselves. There is no
  // mail provider yet, and a "sent!" toast for mail that went nowhere is
  // worse than telling the truth. See docs/12-sharing.md.
  return NextResponse.json({ email: invite.email, role: invite.role, url });
}

/** PATCH — change a member's role. */
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

  const ok = setMemberRole(
    { userId: session.userId, isStaff: session.isStaff },
    mapId,
    parsed.data.userId,
    parsed.data.role,
  );

  if (!ok) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  return NextResponse.json({ ok: true });
}

/** DELETE — remove a member, or an invite. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;

  const session = await requireAuthApi();
  if (session instanceof NextResponse) return session;

  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  const inviteId = url.searchParams.get('inviteId');

  const ctx = { userId: session.userId, isStaff: session.isStaff };

  if (inviteId) {
    const ok = revokeInvite(ctx, mapId, inviteId);
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'userId or inviteId required' },
      { status: 400 },
    );
  }

  const ok = removeMember(ctx, mapId, userId);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Not allowed' }, { status: 403 });
}
