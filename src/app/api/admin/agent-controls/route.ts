import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { killSwitch, setKillSwitch } from '@/lib/agents/safety';

export const dynamic = 'force-dynamic';

/**
 * The global agent kill switch.
 *
 * ── Why this route is deliberately trivial ──────────────────────────────────
 *
 * It is reached when something is going wrong, by someone who needs it to work
 * on the first try. So it takes one boolean, it has no confirmation step to
 * misread, and it is a single UPDATE that every process sees immediately.
 *
 * Staff only, and GET is staff-only too: whether agents are currently stopped,
 * and why, is operational information that says something about the state of
 * the system.
 */

const schema = z.object({
  enabled: z.boolean(),
  reason: z.string().max(200).optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session?.isStaff) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ control: killSwitch() });
}

export async function POST(request: Request) {
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

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the form' }, { status: 400 });
  }

  setKillSwitch(
    { userId: session.userId, isStaff: true },
    parsed.data.enabled,
    parsed.data.reason ?? 'Stopped by staff',
  );

  return NextResponse.json({ control: killSwitch() });
}
