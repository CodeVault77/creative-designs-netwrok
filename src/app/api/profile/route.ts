import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/auth/api';
import { handleTaken, updateProfile } from '@/lib/db/repo';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'What should we call you?')
    .max(60)
    .optional(),
  bio: z.string().trim().max(280).nullable().optional(),
  handle: z
    .string()
    .trim()
    .min(2)
    .max(24)
    .regex(/^[a-z0-9-]+$/, 'Handles use lower-case letters, numbers and dashes')
    .optional(),
});

export async function PATCH(request: Request) {
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Check the form' },
      { status: 400 },
    );
  }

  if (parsed.data.handle && parsed.data.handle !== session.handle) {
    if (handleTaken(parsed.data.handle)) {
      return NextResponse.json({ error: 'That handle is taken' }, { status: 409 });
    }
  }

  // The repository refuses to update anyone but ctx.userId, so a forged id in
  // the body cannot edit someone else's profile.
  const updated = updateProfile(
    { userId: session.userId, isStaff: session.isStaff },
    session.userId,
    parsed.data,
  );

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    handle: updated.handle,
    displayName: updated.displayName,
    bio: updated.bio,
  });
}
