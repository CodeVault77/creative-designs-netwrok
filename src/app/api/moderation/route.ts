import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import {
  MODERATION_ACTIONS,
  actOnReport,
  listAudit,
  listReports,
  type ModerationAction,
} from '@/lib/moderation/repo';

export const dynamic = 'force-dynamic';

/**
 * Screen 21 — the moderation queue.
 *
 * Staff only, and 404 rather than 403 for everyone else. A 403 here would
 * confirm that a moderation surface exists at this path, which is the first
 * thing worth knowing if you intend to attack it.
 */
async function requireStaff() {
  const session = await getSession();
  if (!session?.isStaff) return null;
  return { userId: session.userId, isStaff: true };
}

export async function GET(request: Request) {
  const ctx = await requireStaff();
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const search = new URL(request.url).searchParams;
  const status = search.get('status');
  const targetType = search.get('type');

  return NextResponse.json({
    reports: listReports(ctx, {
      ...(status ? { status } : {}),
      ...(targetType ? { targetType: targetType as 'node' } : {}),
    }),
    audit: listAudit(ctx),
  });
}

const schema = z.object({
  reportId: z.string().max(60),
  action: z.enum(MODERATION_ACTIONS),
  note: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const ctx = await requireStaff();
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const result = actOnReport(
    ctx,
    parsed.data.reportId,
    parsed.data.action as ModerationAction,
    parsed.data.note ?? '',
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    reports: listReports(ctx, { status: 'open' }),
  });
}
