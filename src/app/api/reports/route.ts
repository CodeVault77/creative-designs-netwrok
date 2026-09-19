import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT } from '@/lib/db/repo';
import { clientHash } from '@/lib/services/enquiries';
import { REPORT_REASON_VALUES, fileReport } from '@/lib/moderation/repo';

export const dynamic = 'force-dynamic';

const schema = z.object({
  targetType: z.enum(['node', 'map', 'message', 'user']),
  targetId: z.string().min(1).max(60),
  reason: z.string().max(40),
  detail: z.string().max(1000).optional(),
});

/**
 * POST /api/reports — §15's report flow.
 *
 * "Report lives in the overflow of every node, map, message and profile. One
 * flow, one component, everywhere." One endpoint, correspondingly.
 *
 * Open to signed-out visitors by design: the people most in need of a report
 * button are often not members. Someone who followed a public link and found
 * something abusive should not have to create an account to say so.
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
    return NextResponse.json({ error: 'Check the report form' }, { status: 400 });
  }
  if (!REPORT_REASON_VALUES.includes(parsed.data.reason as never)) {
    return NextResponse.json({ error: 'Choose a reason' }, { status: 400 });
  }

  const session = await getSession();
  const ctx = session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;

  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() || '0.0.0.0';

  const result = fileReport(ctx, {
    ...parsed.data,
    clientHash: clientHash(ip, request.headers.get('user-agent') ?? ''),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  /**
   * The response says nothing about the target.
   *
   * Reporting an id that does not exist returns the same "received" as
   * reporting one that does — otherwise this endpoint becomes a way to test
   * whether a private map or a particular user exists.
   */
  return NextResponse.json({ ok: true });
}
