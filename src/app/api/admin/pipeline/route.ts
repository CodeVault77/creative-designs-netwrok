import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import {
  isStage,
  listPipeline,
  overdue,
  summary,
  updateEntry,
  type Stage,
} from '@/lib/services/pipeline';

export const dynamic = 'force-dynamic';

/**
 * The professional-services pipeline. Staff only, 404 otherwise.
 *
 * GET returns the working list, the per-stage summary and the overdue list in
 * one call. They are always read together — the board, its column totals and
 * the "what is late" strip are one screen — and three round trips could show
 * a summary that disagrees with the list beside it.
 */

const patchSchema = z.object({
  id: z.string().min(1).max(80),
  stage: z.string().max(20).optional(),
  ownerId: z.string().max(80).nullable().optional(),
  quotedCents: z.number().int().min(0).max(1_000_000_00).nullable().optional(),
  /** ISO date or datetime. Null clears the follow-up. */
  nextActionAt: z.string().max(40).nullable().optional(),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.isStaff) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const ctx = { userId: session.userId, isStaff: true };
  const params = new URL(request.url).searchParams;
  const stageParam = params.get('stage');

  // An unrecognised stage is ignored rather than rejected: a stale bookmark
  // should show the default board, not an error.
  const stage: Stage | undefined =
    stageParam && isStage(stageParam) ? stageParam : undefined;

  return NextResponse.json({
    entries: listPipeline(ctx, {
      stage,
      ownerId: params.get('mine') === '1' ? session.userId : undefined,
      includeClosed: params.get('closed') === '1',
    }),
    summary: summary(ctx),
    overdue: overdue(ctx),
  });
}

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

  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the form' }, { status: 400 });
  }

  const { id, ...patch } = parsed.data;
  const ctx = { userId: session.userId, isStaff: true };
  const result = updateEntry(ctx, id, patch);

  if (!result.ok) {
    // A refused stage change is a 400 the caller can act on; a missing row is
    // the same 404 the guard gives, for the same reason.
    const missing = result.error === 'Not found';
    return NextResponse.json(
      { error: result.error },
      { status: missing ? 404 : 400 },
    );
  }

  return NextResponse.json({ entry: result.entry, summary: summary(ctx) });
}
